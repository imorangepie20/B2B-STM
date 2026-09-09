import { Controller,ForbiddenException,Get,Param,Post,Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { NotificationService } from './notification.service';

@Controller('admin/notifications')
export class NotificationController{
  constructor(private readonly service:NotificationService){}
  private allowed(req:SessionRequest){if(!req.principal.mfaVerified||!req.principal.roles.some(role=>role==='system'||role==='operations'))throw new ForbiddenException('Administrator MFA required')}
  @Get()list(@Req()req:SessionRequest){this.allowed(req);return this.service.list()}
  @Post('process')process(@Req()req:SessionRequest){this.allowed(req);return this.service.processDue()}
  @Post(':id/retry')retry(@Req()req:SessionRequest,@Param('id')id:string){this.allowed(req);return this.service.retry(id)}
}
