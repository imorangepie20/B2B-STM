import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type ObservedRequest = {
  method: string;
  originalUrl: string;
  principal?: { id?: string };
  res?: ObservedResponse;
};

type ObservedResponse = {
  locals?: { requestId?: string };
  setHeader(name: string, value: string): void;
  on(event: 'finish', listener: () => void): void;
  statusCode: number;
  status(value: number): ObservedResponse;
  json(value: unknown): ObservedResponse;
};

export function requestIdMiddleware(request: ObservedRequest, response: ObservedResponse, next: () => void) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  response.locals ??= {};
  response.locals.requestId = requestId;
  response.setHeader('X-Request-ID', requestId);
  response.on('finish', () => {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: 'info',
      requestId,
      method: request.method,
      route: new URL(request.originalUrl, 'http://internal').pathname,
      status: response.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
    if (request.principal?.id) entry.principalId = request.principal.id;
    console.log(JSON.stringify(entry));
  });
  next();
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<ObservedRequest>();
    const response = http.getResponse<ObservedResponse>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }
    const requestId = response.locals?.requestId ?? request.res?.locals?.requestId ?? 'unavailable';
    const stack = exception instanceof Error ? exception.stack?.split('\n').slice(1).join('\n') : undefined;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      requestId,
      errorClass: exception instanceof Error ? exception.name : 'UnknownError',
      stack,
    }));
    response.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
