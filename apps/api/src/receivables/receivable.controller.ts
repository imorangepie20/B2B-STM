import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { ReceivableService } from './receivable.service';

@Controller()
export class ReceivableController {
  constructor(private readonly service: ReceivableService) {}
  private internal(req: SessionRequest) { if (!req.principal.mfaVerified || !req.principal.roles.some(role => role === 'system' || role === 'settlement')) throw new ForbiddenException('Settlement MFA required'); }
  private customer(req: SessionRequest) { if (!req.principal.customerId || !req.principal.roles.includes('customer')) throw new ForbiddenException('Customer account required'); }
  @Get('admin/receivables') admin(@Req() req: SessionRequest) { this.internal(req); return this.service.list(); }
  @Get('receivables') customerLedger(@Req() req: SessionRequest) { this.customer(req); return this.service.list(req.principal.customerId!); }
  @Get('admin/payments') payments(@Req() req:SessionRequest){this.internal(req);return this.service.paymentSummary()}
  @Get('payments') customerPayments(@Req() req:SessionRequest){this.customer(req);return this.service.paymentSummary(req.principal.customerId!)}
  @Get('admin/refunds') refunds(@Req() req:SessionRequest){this.internal(req);return this.service.refunds()}
  @Get('admin/refunds/sources') refundSources(@Req() req:SessionRequest){this.internal(req);return this.service.refundSources()}
  @Get('refunds') customerRefunds(@Req() req:SessionRequest){this.customer(req);return this.service.refunds(req.principal.customerId!)}
  @Get('admin/settlements') settlements(@Req() req:SessionRequest,@Query('customerId') customerId?:string,@Query('period') period?:string){this.internal(req);return this.service.settlements(customerId,period)}
  @Get('settlements') customerSettlements(@Req() req:SessionRequest,@Query('period') period?:string){this.customer(req);return this.service.settlements(req.principal.customerId!,period,true)}
  @Post('admin/settlements') draft(@Req() req:SessionRequest,@Body() body:unknown){this.internal(req);return this.service.draft(req.principal.id,body)}
  @Post('admin/settlements/:id/finalize') finalize(@Req() req:SessionRequest,@Param('id') id:string){this.internal(req);return this.service.finalize(req.principal.id,id)}
  @Get('admin/settlements/:id') settlementDetail(@Req() req:SessionRequest,@Param('id') id:string){this.internal(req);return this.service.settlementDetail(id)}
  @Get('settlements/:id') customerSettlementDetail(@Req() req:SessionRequest,@Param('id') id:string){this.customer(req);return this.service.settlementDetail(id,req.principal.customerId!,true)}
  @Post('admin/payments') payment(@Req() req:SessionRequest,@Body() body:unknown){this.internal(req);return this.service.payment(req.principal.id,body)}
  @Post('admin/payments/:id/allocations') allocate(@Req() req:SessionRequest,@Param('id') id:string,@Body() body:unknown){this.internal(req);return this.service.allocate(req.principal.id,id,body)}
  @Post('admin/payments/:id/void') voidPayment(@Req() req:SessionRequest,@Param('id') id:string,@Body() body:unknown){this.internal(req);return this.service.voidPayment(req.principal.id,id,body)}
  @Post('admin/refunds') refund(@Req() req:SessionRequest,@Body() body:unknown){this.internal(req);return this.service.refund(req.principal.id,body)}
}
