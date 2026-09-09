import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { doubleCsrf } from 'csrf-csrf';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { API_CONFIG, ApiConfig } from '../config';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly protection;
  readonly cookieName: string;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {
    const secret = config.csrfSecret ?? randomBytes(32).toString('hex');
    this.cookieName = config.secureCookies ? '__Host-b2b_csrf' : 'b2b_csrf';
    this.protection = doubleCsrf({
      getSecret: () => secret,
      getSessionIdentifier: request => request.cookies.b2b_session ?? '',
      cookieName: this.cookieName,
      cookieOptions: { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/' },
      getCsrfTokenFromRequest: request => typeof request.headers['x-csrf-token'] === 'string' ? request.headers['x-csrf-token'] : undefined,
    });
  }

  private checkCookies(request: Request) {
    const names = (request.headers.cookie ?? '').split(';').map(value => value.trim().split('=')[0]);
    for (const name of ['b2b_session', this.cookieName]) {
      if (names.filter(value => value === name).length > 1) throw new ForbiddenException('Ambiguous cookies');
    }
  }

  issue(request: Request, response: Response) {
    if (request.headers.origin !== undefined && request.headers.origin !== this.config.origin) throw new ForbiddenException('Invalid Origin');
    this.checkCookies(request);
    response.setHeader('Cache-Control', 'no-store');
    return { csrfToken: this.protection.generateCsrfToken(request, response, { overwrite: true }) };
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    if (request.headers.origin !== this.config.origin) throw new ForbiddenException('Invalid Origin');
    this.checkCookies(request);
    if (!this.protection.validateRequest(request)) throw new ForbiddenException('Invalid CSRF token');
    return true;
  }
}
