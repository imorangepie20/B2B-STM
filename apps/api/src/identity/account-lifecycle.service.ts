import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';
import { hashPassword } from './password';
import { AccountEmailService } from './account-email.service';

type Purpose = 'invitation' | 'password_reset';
type Invitation = { email: string; accountType: string; customerId: string | null; roles: string[] };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

@Injectable()
export class AccountLifecycleService {
  constructor(@Inject(DATABASE) private readonly pool: Pool, private readonly email: AccountEmailService) {}

  private async transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect().catch(() => { throw new ServiceUnavailableException('Account service unavailable'); });
    try {
      await db.query('BEGIN');
      // Account administration is infrequent; serialize issue/reissue/consume operations.
      await db.query('SELECT pg_advisory_xact_lock(734012, 2)');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Account already exists');
      throw new ServiceUnavailableException('Account service unavailable');
    } finally { db.release(); }
  }

  private async administrator(db: PoolClient, session: string) {
    const result = await db.query(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
      JOIN user_roles r ON r.user_id=u.id AND r.role='system'
      WHERE s.token_hash=$1 AND u.active AND u.account_type='internal'
        AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '2 hours'
        AND s.mfa_verified_at IS NOT NULL FOR UPDATE OF u, s, r`, [digest(session)]);
    if (!result.rowCount) throw new ForbiddenException('System role and MFA required');
    return result.rows[0].id as string;
  }

  private invitation(body: unknown): Invitation {
    const value = body as Partial<Invitation> | null;
    const roles = value?.roles;
    if (typeof value?.email !== 'string' || value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) ||
        !['internal', 'customer'].includes(value.accountType ?? '') || !Array.isArray(roles) || !roles.length || new Set(roles).size !== roles.length ||
        roles.some(role => typeof role !== 'string' || !(value.accountType === 'customer' ? ['customer'] : ['warehouse', 'operations', 'settlement', 'system']).includes(role)) ||
        (value.accountType === 'customer' ? typeof value.customerId !== 'string' || !uuid.test(value.customerId) : value.customerId != null)) {
      throw new BadRequestException('Invalid invitation');
    }
    return { email: value.email.trim().toLowerCase(), accountType: value.accountType!, customerId: value.customerId ?? null, roles };
  }

  private async activeCustomer(db: PoolClient, customerId: string | null) {
    if (customerId && !(await db.query('SELECT id FROM customers WHERE id=$1 AND active FOR SHARE', [customerId])).rowCount) {
      throw new BadRequestException('Customer unavailable');
    }
  }

  async list(session: string) {
    const db = await this.pool.connect().catch(() => { throw new ServiceUnavailableException('Account service unavailable'); });
    try {
      await db.query('BEGIN');
      await this.administrator(db, session);
      const result = await db.query(`SELECT u.id,u.email,u.account_type AS "accountType",u.customer_id AS "customerId",
        c.code AS "customerCode",c.name AS "customerName",u.active,u.created_at AS "createdAt",
        u.password_hash IS NOT NULL AS "passwordConfigured",
        COALESCE((SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id=u.id),'{}') AS roles,
        EXISTS(SELECT 1 FROM account_tokens t WHERE t.user_id=u.id AND t.purpose='invitation'
          AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now()) AS "invitationPending",
        (SELECT t.expires_at FROM account_tokens t WHERE t.user_id=u.id AND t.consumed_at IS NULL
          AND t.revoked_at IS NULL ORDER BY t.created_at DESC LIMIT 1) AS "tokenExpiresAt",
        (SELECT json_build_object('status',d.status,'purpose',d.purpose,'createdAt',d.created_at)
          FROM account_email_deliveries d WHERE d.user_id=u.id ORDER BY d.created_at DESC LIMIT 1) AS "lastDelivery"
        FROM users u LEFT JOIN customers c ON c.id=u.customer_id
        ORDER BY u.active DESC,u.email`);
      await db.query('COMMIT');
      return result.rows;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Account service unavailable');
    } finally { db.release(); }
  }

  async setStatus(session: string, userId: string, body: unknown) {
    const value = body as { active?: unknown; reason?: unknown } | null;
    const reason = typeof value?.reason === 'string' ? value.reason.trim() : '';
    if (!uuid.test(userId) || typeof value?.active !== 'boolean' || reason.length < 4 || reason.length > 300) {
      throw new BadRequestException('Invalid account status change');
    }
    return this.transaction(async db => {
      const actor = await this.administrator(db, session);
      if (actor === userId) throw new ConflictException('Cannot change your own account status');
      const result = await db.query('SELECT active,customer_id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!result.rowCount) throw new NotFoundException('Account unavailable');
      if (result.rows[0].active === value.active) return { id: userId, active: value.active, changed: false };
      if (value.active) await this.activeCustomer(db, result.rows[0].customer_id);
      await db.query('UPDATE users SET active=$2 WHERE id=$1', [userId, value.active]);
      if (!value.active) {
        await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
        await db.query('UPDATE account_tokens SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [userId]);
      }
      await db.query(`INSERT INTO account_status_changes(id,user_id,changed_by,active,reason)
        VALUES($1,$2,$3,$4,$5)`, [randomUUID(), userId, actor, value.active, reason]);
      return { id: userId, active: value.active, changed: true };
    });
  }

  private async issue(db: PoolClient, userId: string, actor: string, recipient:string, purpose: Purpose) {
    const token = randomBytes(32).toString('hex');
    await db.query('UPDATE account_tokens SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [userId]);
    const result = await db.query(`INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at)
      VALUES ($1,$2,$3,now()+$4::interval) RETURNING expires_at`, [digest(token), userId, purpose, purpose === 'invitation' ? '24 hours' : '30 minutes']);
    await db.query('INSERT INTO identity_events(user_id,actor_id,event) VALUES ($1,$2,$3)', [userId, actor, `${purpose}_issued`]);
    return { userId, token, expiresAt: result.rows[0].expires_at as Date, recipient, purpose };
  }

  private async delivered(issued: Awaited<ReturnType<AccountLifecycleService['issue']>>) {
    const delivery=await this.email.deliver(issued.userId,issued.recipient,issued.purpose,issued.token,issued.expiresAt);
    const {recipient:_,purpose:__,...response}=issued;
    return {...response,delivery};
  }

  async invite(session: string, body: unknown) {
    const issued=await this.transaction(async db => {
      const actor = await this.administrator(db, session);
      const value = this.invitation(body);
      await this.activeCustomer(db, value.customerId);
      const id = randomUUID();
      await db.query('INSERT INTO users(id,email,account_type,customer_id) VALUES ($1,$2,$3,$4)', [id, value.email, value.accountType, value.customerId]);
      for (const role of value.roles) await db.query('INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,$2,$3)', [id, value.accountType, role]);
      return this.issue(db, id, actor, value.email, 'invitation');
    });
    return this.delivered(issued);
  }

  async reissue(session: string, userId: string, purpose: Purpose) {
    if (!uuid.test(userId)) throw new BadRequestException('Invalid user ID');
    const issued=await this.transaction(async db => {
      const actor = await this.administrator(db, session);
      const result = await db.query('SELECT email,password_hash,customer_id FROM users WHERE id=$1 AND active FOR UPDATE', [userId]);
      if (!result.rowCount) throw new NotFoundException('Account unavailable');
      const user = result.rows[0];
      if ((purpose === 'invitation') !== (user.password_hash === null)) throw new ConflictException('Account state does not match token purpose');
      await this.activeCustomer(db, user.customer_id);
      return this.issue(db, userId, actor, user.email, purpose);
    });
    return this.delivered(issued);
  }

  async complete(body: unknown, purpose: Purpose) {
    const value = body as { token?: unknown; password?: unknown } | null;
    if (typeof value?.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token) || typeof value.password !== 'string' ||
        [...value.password].length < 12 || [...value.password].length > 128 || Buffer.byteLength(value.password, 'utf8') > 512) {
      throw new BadRequestException('Invalid token or password (12–128 characters required)');
    }
    const tokenHash = digest(value.token);
    // Reject random, expired or consumed tokens before expensive password hashing.
    const candidate = await this.pool.query(`SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose=$2
      AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()`, [tokenHash, purpose])
      .catch(() => { throw new ServiceUnavailableException('Account service unavailable'); });
    if (!candidate.rowCount) throw new BadRequestException('Invalid or expired token');
    const passwordHash = await hashPassword(value.password);
    return this.transaction(async db => {
      const userId = candidate.rows[0].user_id;
      const result = await db.query('SELECT active,password_hash,customer_id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const user = result.rows[0];
      if (!user?.active || ((purpose === 'invitation') !== (user.password_hash === null))) throw new BadRequestException('Invalid or expired token');
      await this.activeCustomer(db, user.customer_id);
      const consumed = await db.query(`UPDATE account_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose=$2
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING user_id`, [tokenHash, purpose]);
      if (!consumed.rowCount) throw new BadRequestException('Invalid or expired token');
      await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, userId]);
      await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      await db.query('UPDATE account_tokens SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [userId]);
      await db.query('INSERT INTO identity_events(user_id,actor_id,event) VALUES ($1,$1,$2)', [userId, purpose === 'invitation' ? 'invitation_accepted' : 'password_reset_completed']);
      return { status: 'ok' };
    });
  }
}
