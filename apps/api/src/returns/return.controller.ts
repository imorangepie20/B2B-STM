import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { parsePagination } from '../orders/pagination';
import { parseQueueSearch } from '../orders/queue-search';
import { ReturnService } from './return.service';

@Controller()
export class ReturnController {
  constructor(private readonly service: ReturnService) {}
  private customer(req: SessionRequest) { if (!req.principal.customerId || !req.principal.roles.includes('customer')) throw new ForbiddenException('Customer account required'); }
  private warehouse(req: SessionRequest) { if (req.principal.roles.includes('warehouse') || (req.principal.roles.includes('system') && req.principal.mfaVerified)) return; throw new ForbiddenException('Warehouse role required'); }
  private operator(req: SessionRequest) { if (!req.principal.mfaVerified || !req.principal.roles.some(role => role === 'system' || role === 'operations')) throw new ForbiddenException('Administrator MFA required'); }
  @Get('returns/shipment-lines') shipmentLines(@Req() req: SessionRequest) { this.customer(req); return this.service.shipmentLines(req.principal.customerId!); }
  @Post('returns') request(@Req() req: SessionRequest, @Body() body: unknown) { this.customer(req); return this.service.request(req.principal.customerId!, req.principal.id, body); }
  @Get('warehouse/returns/queue') queue(@Req() req: SessionRequest, @Query() query: Record<string, string | undefined>) {
    this.warehouse(req);
    if (query.page === undefined && query.pageSize === undefined && query.query === undefined) return this.service.queue();
    return this.service.queue(parsePagination(query.page, query.pageSize), parseQueueSearch(query.query));
  }
  @Get('admin/returns/credits/pending') pendingCredits(@Req() req: SessionRequest,@Query() query:Record<string,string|undefined>) {
    this.operator(req);
    if(query.page===undefined&&query.pageSize===undefined&&query.query===undefined)return this.service.pendingCredits();
    return this.service.pendingCredits(parsePagination(query.page,query.pageSize),parseQueueSearch(query.query));
  }
  @Post('warehouse/returns/lines/:returnLineId/inspect') inspect(@Req() req: SessionRequest, @Param('returnLineId') returnLineId: string, @Body() body: unknown) { this.warehouse(req); return this.service.inspect(req.principal.id, returnLineId, body); }
  @Post('admin/returns/inspections/:inspectionId/defects') defectDisposition(@Req() req: SessionRequest, @Param('inspectionId') inspectionId: string, @Body() body: unknown) { this.operator(req); return this.service.defectDisposition(req.principal.id, inspectionId, body); }
  @Get('admin/returns/defects/quarantined') quarantinedDefects(@Req() req: SessionRequest) { this.operator(req); return this.service.quarantinedDefects(); }
  @Post('admin/returns/defects/:dispositionId/resolve') resolveDefect(@Req() req: SessionRequest, @Param('dispositionId') dispositionId: string, @Body() body: unknown) { this.operator(req); return this.service.resolveDefect(req.principal.id, dispositionId, body); }
  @Post('admin/returns/inspections/:inspectionId/credit') credit(@Req() req: SessionRequest, @Param('inspectionId') inspectionId: string, @Body() body: unknown) { this.operator(req); return this.service.credit(req.principal.id, inspectionId, body); }
}
