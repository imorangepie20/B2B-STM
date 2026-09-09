import { Body, Controller, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { StockCountService } from './stock-count.service';

@Controller('admin/stock-counts')
export class StockCountController {
  constructor(private readonly service:StockCountService){}
  private allowed(req:SessionRequest){if(!req.principal.mfaVerified||!req.principal.roles.some(role=>role==='system'||role==='operations'))throw new ForbiddenException('Administrator MFA required')}
  @Get() list(@Req() req:SessionRequest){this.allowed(req);return this.service.list()}
  @Post() start(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.start(req.principal.id,body)}
  @Post(':id/finalize') finalize(@Req() req:SessionRequest,@Param('id') id:string,@Body() body:unknown){this.allowed(req);return this.service.finalize(req.principal.id,id,body)}
  @Post(':id/cancel') cancel(@Req() req:SessionRequest,@Param('id') id:string,@Body() body:unknown){this.allowed(req);return this.service.cancel(req.principal.id,id,body)}
}
