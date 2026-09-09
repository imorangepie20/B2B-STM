import 'reflect-metadata';
import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { API_CONFIG, readConfig } from './config';
import cookieParser from 'cookie-parser';
import { CsrfGuard } from './identity/csrf.guard';

import { DATABASE } from './database';
import { PublicEndpoint, SessionGuard } from './identity/session.guard';
import { IdentityController } from './identity/identity.controller';
import { PasswordLoginService } from './identity/password-login.service';
import { AccountLifecycleService } from './identity/account-lifecycle.service';
import { AccountLifecycleController } from './identity/account-lifecycle.controller';
import { AccountEmailService } from './identity/account-email.service';
import { MfaService } from './identity/mfa.service';
import { MfaController } from './identity/mfa.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { OrderController } from './orders/order.controller';
import { OrderService } from './orders/order.service';
import { ReturnController } from './returns/return.controller';
import { ReturnService } from './returns/return.service';
import { ReceivableController } from './receivables/receivable.controller';
import { ReceivableService } from './receivables/receivable.service';
import { InitialImportController } from './imports/initial-import.controller';
import { InitialImportService } from './imports/initial-import.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { StockCountController } from './stock-counts/stock-count.controller';
import { StockCountService } from './stock-counts/stock-count.service';
import { DataExportController } from './exports/data-export.controller';
import { DataExportService } from './exports/data-export.service';
import { AttachmentController } from './attachments/attachment.controller';
import { AttachmentService } from './attachments/attachment.service';
import { AttachmentMalwareScanner } from './attachments/attachment-malware-scanner';
import { NotificationController } from './notifications/notification.controller';
import { NotificationService } from './notifications/notification.service';
import { requestIdMiddleware, SafeExceptionFilter } from './observability/request-observability';

@Controller('health')
@PublicEndpoint()
class HealthController {
  constructor(@Inject(DATABASE) private readonly pool: Pool,private readonly malwareScanner:AttachmentMalwareScanner) {}

  @Get('live')
  live() { return { status: 'ok' }; }

  @Get('ready')
  async ready() {
    try {
      const result = await this.pool.query("SELECT value FROM public.application_metadata WHERE key = 'application'");
      if (result.rows[0]?.value !== 'b2b-stm') throw new Error('Missing application metadata');
      await this.malwareScanner.ready();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Service not ready');
    }
  }
}

export async function createApplication(env: NodeJS.ProcessEnv = process.env) {
  const config = readConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 2000, query_timeout: 3000 });
  // Idle connection errors must not crash the process or leak connection details.
  pool.on('error', () => console.error('Database idle connection unavailable'));
  @Module({
    controllers: [HealthController, IdentityController, AccountLifecycleController, MfaController, CatalogController, OrderController, ReturnController, ReceivableController, InitialImportController, AuditController, AnalyticsController, StockCountController, DataExportController, AttachmentController, NotificationController],
    providers: [MfaService, AccountEmailService, CatalogService, OrderService, ReturnService, ReceivableService, InitialImportService, AuditService, AnalyticsService, StockCountService, DataExportService, AttachmentMalwareScanner, AttachmentService, NotificationService, { provide: DATABASE, useValue: pool }, { provide: API_CONFIG, useValue: config }, CsrfGuard,
      { provide: APP_GUARD, useExisting: CsrfGuard }, PasswordLoginService, AccountLifecycleService, { provide: APP_GUARD, useClass: SessionGuard }, {
      provide: 'DATABASE_LIFECYCLE',
      useValue: { onApplicationShutdown: () => pool.end() },
    }],
  })
  class ApplicationModule {}
  try {
    const app = await NestFactory.create<NestExpressApplication>(ApplicationModule, { logger: false });
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new SafeExceptionFilter());
    app.useBodyParser('raw', { type: ['image/jpeg','image/png','application/pdf'], limit: '10mb' });
    app.useBodyParser('json', { limit: '2mb' });
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableShutdownHooks();
    return app;
  } catch (error) { await pool.end(); throw error; }
}

