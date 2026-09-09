import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { DATABASE } from '../database';

export const PublicEndpoint = () => SetMetadata('publicEndpoint', true);
export interface Principal { id: string; customerId: string | null; roles: string[]; mfaVerified: boolean }
export interface SessionRequest { headers: { cookie?: string }; principal: Principal }

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly pool: Pool, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride('publicEndpoint', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const values = (request.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith('b2b_session='));
    const token = values[0]?.slice('b2b_session='.length);
    if (values.length !== 1 || !token || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    let row;
    try {
      const result = await this.pool.query(`
        UPDATE sessions s SET last_seen_at=now() FROM users u
        WHERE s.user_id=u.id AND s.token_hash=$1 AND s.revoked_at IS NULL
          AND s.expires_at>now() AND s.last_seen_at>now()-interval '2 hours' AND u.active
          AND (u.customer_id IS NULL OR EXISTS (SELECT 1 FROM customers c WHERE c.id=u.customer_id AND c.active))
        RETURNING u.id, u.customer_id, s.mfa_verified_at,
          ARRAY(SELECT r.role FROM user_roles r WHERE r.user_id=u.id ORDER BY r.role) AS roles`,
        [createHash('sha256').update(token).digest('hex')]);
      row = result.rows[0];
    } catch { throw new ServiceUnavailableException('Authentication unavailable'); }
    if (!row) throw new UnauthorizedException();
    request.principal = { id: row.id, customerId: row.customer_id, roles: row.roles, mfaVerified: Boolean(row.mfa_verified_at) };
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    return true;
  }
}
