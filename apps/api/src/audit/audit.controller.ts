import { Controller,ForbiddenException,Get,Query,Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { parsePagination } from '../orders/pagination';
import { AuditService } from './audit.service';
@Controller('admin/audit-events')
export class AuditController{
  constructor(private readonly service:AuditService){}
  @Get() list(@Req() req:SessionRequest,@Query() query:Record<string,string|undefined>){if(!req.principal.mfaVerified||!req.principal.roles.some(role=>role==='system'||role==='operations'))throw new ForbiddenException('Administrator MFA required');return this.service.list(parsePagination(query.page,query.pageSize),query)}
}
