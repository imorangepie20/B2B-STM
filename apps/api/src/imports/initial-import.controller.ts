import { Body, Controller, ForbiddenException, Get, Post, Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { InitialImportService } from './initial-import.service';

@Controller('admin/imports')
export class InitialImportController {
  constructor(private readonly service: InitialImportService) {}
  private allowed(req: SessionRequest) {
    if (!req.principal.mfaVerified || !req.principal.roles.some(role => role === 'system' || role === 'operations')) throw new ForbiddenException('Administrator MFA required');
  }
  @Post('preview') preview(@Req() req: SessionRequest, @Body() body: unknown) { this.allowed(req); return this.service.preview(body); }
  @Post('apply') apply(@Req() req: SessionRequest, @Body() body: unknown) { this.allowed(req); return this.service.apply(req.principal.id, body); }
  @Get() batches(@Req() req: SessionRequest) { this.allowed(req); return this.service.batches(); }
}

