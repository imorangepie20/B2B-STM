import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { PasswordLoginService } from './password-login.service';
import { Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { DATABASE } from '../database';
import { API_CONFIG, ApiConfig } from '../config';
import { CsrfGuard } from './csrf.guard';
import { PublicEndpoint, SessionRequest } from './session.guard';

@Controller('auth')
export class IdentityController {
  constructor(private readonly passwordLogin: PasswordLoginService, private readonly csrf: CsrfGuard,
    @Inject(DATABASE) private readonly pool: Pool, @Inject(API_CONFIG) private readonly config: ApiConfig) {}

  @PublicEndpoint()
  @Get('csrf')
  csrfToken(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.csrf.issue(request, response);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      await this.pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
        [createHash('sha256').update(request.cookies.b2b_session).digest('hex')]);
    } catch { throw new ServiceUnavailableException('Authentication unavailable'); }
    response.clearCookie('b2b_session', { httpOnly: true, secure: this.config.secureCookies, sameSite: 'lax', path: '/' });
    response.clearCookie(this.csrf.cookieName, { httpOnly: true, secure: this.config.secureCookies, sameSite: 'lax', path: '/' });
  }

  @PublicEndpoint()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: unknown; password?: unknown }, @Res({ passthrough: true }) response: Response, @Req() request: Request) {
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string' || !body.email.trim() || !body.password) {
      throw new ForbiddenException('Invalid email or password');
    }
    const { token } = await this.passwordLogin.login(body.email, body.password, request.ip ?? request.socket?.remoteAddress ?? 'unknown');
    response.cookie('b2b_session', token, { httpOnly: true, secure: this.config.secureCookies, sameSite: 'lax', path: '/', maxAge: 12 * 60 * 60 * 1000 });
    response.clearCookie(this.csrf.cookieName, { httpOnly: true, secure: this.config.secureCookies, sameSite: 'lax', path: '/' });
    response.setHeader('Cache-Control', 'no-store');
    return { status: 'ok' };
  }

  @Get('me')
  me(@Req() request: SessionRequest) { return request.principal; }

  @Get('workspaces/:role')
  workspace(@Param('role') role: string, @Req() request: SessionRequest) {
    if (!['customer','warehouse','operations','settlement','system'].includes(role) || !request.principal.roles.includes(role)) {
      throw new ForbiddenException();
    }
    if (['operations','settlement','system'].includes(role) && !request.principal.mfaVerified) throw new ForbiddenException('MFA required');
    return { workspace: role, customerId: request.principal.customerId };
  }
}



