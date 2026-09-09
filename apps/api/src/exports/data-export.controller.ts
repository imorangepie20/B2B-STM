import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SessionRequest } from '../identity/session.guard';
import { DataExportService } from './data-export.service';

@Controller('admin/exports')
export class DataExportController {
  constructor(private readonly service: DataExportService) {}

  @Get(':dataset')
  async download(@Req() req: SessionRequest, @Param('dataset') dataset: string, @Query() query: Record<string, string | undefined>, @Res() response: Response) {
    if (!req.principal.mfaVerified) throw new ForbiddenException('Administrator MFA required');
    const roles = req.principal.roles;
    const allowed = dataset === 'settlements' ? roles.some(role => role === 'system' || role === 'settlement') : roles.some(role => role === 'system' || role === 'operations');
    if (!allowed) throw new ForbiddenException('Export role required');
    if (Object.keys(query).some(key => !['format','query','status','from','to','customerId','period'].includes(key))) throw new BadRequestException('Unknown export filter');
    const file = await this.service.create(req.principal.id, dataset, query);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.body);
  }
}
