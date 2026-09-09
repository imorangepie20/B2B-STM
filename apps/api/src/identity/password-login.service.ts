import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';
import { createSessionToken, verifyPassword } from './password';

const maximumFailures = 5;
const failureWindow = '15 minutes';
export interface LoginResult { token: string }

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

@Injectable()
export class PasswordLoginService {
  constructor(@Inject(DATABASE) private readonly pool: Pool) {}

  async login(email: string, password: string, ip: string): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const emailKey = digest(normalizedEmail);
    const ipKey = digest(ip);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const key of [emailKey, ipKey].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const blocked = await this.isBlocked(client, emailKey, ipKey);
      if (blocked) {
        await client.query('ROLLBACK');
        throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
      }
      const result = await client.query('SELECT id, password_hash FROM users WHERE email=$1 AND active=true FOR UPDATE', [normalizedEmail]);
      const user = result.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("INSERT INTO login_failures(scope,scope_key) VALUES ('email',$1),('ip',$2)", [emailKey, ipKey]);
        await client.query('COMMIT');
        throw new UnauthorizedException('Invalid email or password');
      }
      const token = createSessionToken();
      await client.query('DELETE FROM login_failures WHERE scope=$1 AND scope_key=$2', ['email', emailKey]);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
      await client.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at) VALUES ($1,$2,now()+interval '12 hours',now())", [digest(token), user.id]);
      await client.query('COMMIT');
      return { token };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  private async isBlocked(client: PoolClient, emailKey: string, ipKey: string): Promise<boolean> {
    const result = await client.query(`
      SELECT scope, count(*)::int AS failures FROM login_failures
      WHERE ((scope='email' AND scope_key=$1) OR (scope='ip' AND scope_key=$2))
        AND failed_at > now() - $3::interval
      GROUP BY scope`, [emailKey, ipKey, failureWindow]);
    return result.rows.some(row => row.failures >= maximumFailures);
  }
}
