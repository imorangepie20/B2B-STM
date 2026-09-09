import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SessionRequest } from '../identity/session.guard';
import { AttachmentService } from './attachment.service';

@Controller('attachments')
export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}

  @Get(':resourceType/:resourceId')
  list(@Req() req: SessionRequest, @Param('resourceType') type: string, @Param('resourceId') id: string) {
    return this.service.list(req.principal, type, id);
  }

  @Post(':resourceType/:resourceId')
  upload(@Req() req: SessionRequest, @Param('resourceType') type: string, @Param('resourceId') id: string, @Query('filename') filename: string | undefined, @Headers('content-type') mediaType: string | undefined, @Body() content: Buffer) {
    return this.service.upload(req.principal, type, id, filename, mediaType, content);
  }

  @Get('file/:id/content')
  async download(@Req() req: SessionRequest, @Param('id') id: string, @Res() response: Response) {
    const file = await this.service.content(req.principal, id);
    response.setHeader('Content-Type', file.mediaType);
    response.setHeader('Content-Length', String(file.byteSize));
    response.setHeader('Content-Disposition', `attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.content);
  }
}
