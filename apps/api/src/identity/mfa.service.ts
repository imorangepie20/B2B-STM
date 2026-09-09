import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';
import { API_CONFIG, ApiConfig } from '../config';
import { verifyPassword } from './password';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Action = 'enroll' | 'confirm' | 'verify' | 'recover' | 'regenerate';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MfaService {
  constructor(@Inject(DATABASE) private readonly pool: Pool, @Inject(API_CONFIG) private readonly config: ApiConfig) {}

  async status(userId: string) {
    try {
      const result = await this.pool.query('SELECT confirmed_at FROM mfa_credentials WHERE user_id=$1', [userId]);
      return { enrolled: Boolean(result.rows[0]?.confirmed_at) };
    } catch { throw new ServiceUnavailableException('MFA unavailable'); }
  }

  private seal(secret: string, userId: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.config.mfaKey!, 'hex'), iv);
    cipher.setAAD(Buffer.from(userId));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('hex')).join('.');
  }

  private open(encoded: string, userId: string) {
    const [iv, tag, encrypted] = encoded.split('.').map(value => Buffer.from(value, 'hex'));
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.config.mfaKey!, 'hex'), iv);
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  private async administrator(db: PoolClient, sessionToken: string) {
    const result = await db.query(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
      JOIN user_roles r ON r.user_id=u.id AND r.role='system'
      WHERE s.token_hash=$1 AND u.active AND u.account_type='internal'
        AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_seen_at>clock_timestamp()-interval '2 hours'
        AND s.mfa_verified_at IS NOT NULL FOR UPDATE OF u,s,r`, [digest(sessionToken)]);
    if (!result.rowCount) throw new ForbiddenException('System role and MFA required');
    return result.rows[0].id as string;
  }

  private async transaction<T>(work: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect().catch(() => { throw new ServiceUnavailableException('MFA unavailable'); });
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('MFA unavailable');
    } finally { db.release(); }
  }

  async enrolledUsers(sessionToken: string) {
    return this.transaction(async db => {
      await this.administrator(db, sessionToken);
      const result = await db.query(`SELECT u.id,u.email,ARRAY(SELECT role FROM user_roles WHERE user_id=u.id ORDER BY role) AS roles,
        c.confirmed_at AS "confirmedAt" FROM users u JOIN mfa_credentials c ON c.user_id=u.id AND c.confirmed_at IS NOT NULL
        WHERE u.active ORDER BY u.email`);
      return result.rows;
    });
  }

  async resetByAdministrator(sessionToken: string, targetUserId: string, body: unknown) {
    const value = body as { requestId?: unknown; reason?: unknown } | null;
    const requestId = typeof value?.requestId === 'string' ? value.requestId : '';
    const reason = typeof value?.reason === 'string' ? value.reason.trim() : '';
    if (!uuid.test(targetUserId) || !uuid.test(requestId) || [...reason].length < 4 || [...reason].length > 300) throw new BadRequestException('Invalid MFA reset request');
    return this.transaction(async db => {
      const actorId = await this.administrator(db, sessionToken);
      if (actorId === targetUserId) throw new ConflictException('Administrator cannot reset own MFA');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${actorId}:mfa.reset:${requestId}`]);
      const stored = await db.query('SELECT response FROM command_results WHERE actor_id=$1 AND command_type=$2 AND request_id=$3', [actorId, 'mfa.reset', requestId]);
      if (stored.rowCount) return stored.rows[0].response;
      if (!(await db.query('SELECT id FROM users WHERE id=$1 AND active FOR UPDATE', [targetUserId])).rowCount) throw new NotFoundException('Account unavailable');
      const credential = await db.query('SELECT confirmed_at FROM mfa_credentials WHERE user_id=$1 FOR UPDATE', [targetUserId]);
      if (!credential.rows[0]?.confirmed_at) throw new ConflictException('MFA is not enrolled');
      await db.query(`UPDATE mfa_credentials SET encrypted_secret=NULL,enrollment_session_hash=NULL,enrollment_expires_at=NULL,
        confirmed_at=NULL,last_time_step=NULL,failed_attempts=0,locked_until=NULL WHERE user_id=$1`, [targetUserId]);
      await db.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [targetUserId]);
      await db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL', [targetUserId]);
      await db.query('INSERT INTO mfa_device_resets(id,user_id,reset_by,reason) VALUES ($1,$2,$3,$4)', [randomUUID(), targetUserId, actorId, reason]);
      await db.query("INSERT INTO mfa_events(user_id,event) VALUES ($1,'reset')", [targetUserId]);
      await db.query("INSERT INTO identity_events(user_id,actor_id,event) VALUES ($1,$2,'mfa_reset')", [targetUserId, actorId]);
      const response = { userId: targetUserId, status: 'mfa_reset' };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,$2,$3,$4)', [actorId, 'mfa.reset', requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async execute(sessionToken: string, action: Action, body: unknown) {
    if (!this.config.mfaKey) throw new ServiceUnavailableException('MFA encryption key is not configured');
    const value = body as { password?: unknown; code?: unknown } | null;
    const sessionHash = digest(sessionToken);
    const db = await this.pool.connect().catch(() => { throw new ServiceUnavailableException('MFA unavailable'); });
    try {
      await db.query('BEGIN');
      // Match login's user-before-session lock order, and recheck the session after waiting.
      const candidate = await db.query('SELECT user_id FROM sessions WHERE token_hash=$1', [sessionHash]);
      if (!candidate.rowCount) throw new UnauthorizedException();
      const id = candidate.rows[0].user_id;
      const userResult = await db.query('SELECT id,email,password_hash,active,customer_id FROM users WHERE id=$1 FOR UPDATE', [id]);
      const user = userResult.rows[0];
      if (!user?.active) throw new UnauthorizedException();
      const session = await db.query(`SELECT token_hash,mfa_verified_at FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL
        AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '2 hours' FOR UPDATE`, [sessionHash]);
      if (!session.rowCount) throw new UnauthorizedException();
      if (user.customer_id && !(await db.query('SELECT id FROM customers WHERE id=$1 AND active FOR SHARE', [user.customer_id])).rowCount) throw new UnauthorizedException();
      await db.query('INSERT INTO mfa_credentials(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
      const credential = (await db.query('SELECT *, locked_until>clock_timestamp() AS locked, enrollment_expires_at>clock_timestamp() AS pending_valid FROM mfa_credentials WHERE user_id=$1 FOR UPDATE', [id])).rows[0];
      if (credential.locked) throw new HttpException('Too many MFA attempts', 429);
      const fail = async () => {
        await db.query(`UPDATE mfa_credentials SET
          failed_attempts=CASE WHEN locked_until IS NOT NULL THEN 1 ELSE failed_attempts+1 END,
          locked_until=CASE WHEN locked_until IS NULL AND failed_attempts>=4 THEN clock_timestamp()+interval '15 minutes' ELSE NULL END WHERE user_id=$1`, [id]);
        await db.query("INSERT INTO mfa_events(user_id,event) VALUES ($1,'failed')", [id]);
        await db.query('COMMIT');
        throw new UnauthorizedException('Invalid MFA credentials');
      };
      let result: object = { status: 'ok' };
      let event: string;
      if (action === 'enroll') {
        if (credential.confirmed_at) throw new ConflictException('MFA already enrolled');
        if (typeof value?.password !== 'string' || value.password.length>512 || !await verifyPassword(value.password, user.password_hash)) return await fail();
        const secret = generateSecret();
        await db.query(`UPDATE mfa_credentials SET encrypted_secret=$2,enrollment_session_hash=$3,
          enrollment_expires_at=clock_timestamp()+interval '10 minutes',last_time_step=NULL WHERE user_id=$1`, [id, this.seal(secret, id), sessionHash]);
        result = { secret, uri: generateURI({ issuer: 'B2B-STM', label: user.email, secret }) };
        event = 'enrolled';
      } else {
        if (action === 'confirm') {
          if (credential.confirmed_at || !credential.pending_valid || credential.enrollment_session_hash !== sessionHash) throw new BadRequestException('Enrollment unavailable');
        } else if (!credential.confirmed_at) throw new BadRequestException('MFA not enrolled');
        if (action === 'regenerate') {
          if (!session.rows[0].mfa_verified_at || typeof value?.password !== 'string' || value.password.length>512 || !await verifyPassword(value.password, user.password_hash) || typeof value?.code !== 'string' || !/^\d{6}$/.test(value.code)) return await fail();
          const verified = await verify({ secret: this.open(credential.encrypted_secret, id), token: value.code, epochTolerance: 30, afterTimeStep: credential.last_time_step === null ? undefined : Number(credential.last_time_step) });
          if (!verified.valid || !('timeStep' in verified)) return await fail();
          const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));
          await db.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [id]);
          for (const code of recoveryCodes) await db.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES ($1,$2)', [id, digest(code)]);
          await db.query('UPDATE mfa_credentials SET last_time_step=$2 WHERE user_id=$1', [id, verified.timeStep]);
          result = { recoveryCodes };
          event = 'recovery_codes_regenerated';
        } else if (action === 'recover') {
          if (typeof value?.code !== 'string' || !/^[a-f0-9]{32}$/.test(value.code)) return await fail();
          const consumed = await db.query('UPDATE mfa_recovery_codes SET consumed_at=now() WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL RETURNING code_hash', [id, digest(value.code)]);
          if (!consumed.rowCount) return await fail();
          event = 'recovered';
        } else {
          if (typeof value?.code !== 'string' || !/^\d{6}$/.test(value.code)) return await fail();
          const verified = await verify({ secret: this.open(credential.encrypted_secret, id), token: value.code,
            epochTolerance: 30, afterTimeStep: credential.last_time_step === null ? undefined : Number(credential.last_time_step) });
          if (!verified.valid || !('timeStep' in verified)) return await fail();
          await db.query('UPDATE mfa_credentials SET last_time_step=$2 WHERE user_id=$1', [id, verified.timeStep]);
          event = action === 'confirm' ? 'confirmed' : 'verified';
          if (action === 'confirm') {
            const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));
            for (const code of recoveryCodes) await db.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES ($1,$2)', [id, digest(code)]);
            await db.query('UPDATE mfa_credentials SET confirmed_at=now(),enrollment_session_hash=NULL,enrollment_expires_at=NULL WHERE user_id=$1', [id]);
            result = { recoveryCodes };
          }
        }
        await db.query('UPDATE sessions SET mfa_verified_at=now() WHERE token_hash=$1', [sessionHash]);
      }
      await db.query('UPDATE mfa_credentials SET failed_attempts=0,locked_until=NULL WHERE user_id=$1', [id]);
      await db.query('INSERT INTO mfa_events(user_id,event) VALUES ($1,$2)', [id, event]);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('MFA unavailable');
    } finally { db.release(); }
  }
}
