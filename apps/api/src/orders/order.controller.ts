import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { OrderService } from './order.service';
import { parsePagination } from './pagination';
import { parseOrderFilters } from './order-filters';
import { parseQueueSearch } from './queue-search';

@Controller()
export class OrderController {
  constructor(private readonly service: OrderService) {}
  private customer(req: SessionRequest) {
    if (!req.principal.customerId || !req.principal.roles.includes('customer')) throw new ForbiddenException('Customer account required');
  }
  private operator(req: SessionRequest) {
    if (!req.principal.mfaVerified || !req.principal.roles.some(role => role === 'system' || role === 'operations')) throw new ForbiddenException('Administrator MFA required');
  }
  private warehouse(req: SessionRequest) {
    if (req.principal.roles.includes('warehouse')) return;
    if (req.principal.roles.includes('system') && req.principal.mfaVerified) return;
    throw new ForbiddenException('Warehouse role required');
  }
  @Get('orders/catalog') catalog(@Req() req: SessionRequest) { this.customer(req); return this.service.catalog(req.principal.customerId!); }
  @Get('orders') history(@Req() req: SessionRequest, @Query() query:Record<string,string|undefined>) { this.customer(req); return this.service.customerOrders(req.principal.customerId!, parsePagination(query.page,query.pageSize),parseOrderFilters(query.query,query.status,query.from,query.to,['active','completed','cancelled'])); }
  @Post('orders') submit(@Req() req: SessionRequest, @Body() body: unknown) { this.customer(req); return this.service.submit(req.principal.customerId!, req.principal.id, body); }
  @Post('orders/:orderId/cancellation-requests') requestCancellation(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.customer(req); return this.service.requestCancellation(req.principal.customerId!, req.principal.id, orderId, body); }
  @Get('warehouse/shipments/queue') queue(@Req() req: SessionRequest, @Query() query: Record<string, string | undefined>) {
    this.warehouse(req);
    if (query.page === undefined && query.pageSize === undefined && query.query === undefined) return this.service.shipmentQueue(req.principal.id);
    return this.service.shipmentQueue(req.principal.id, parsePagination(query.page, query.pageSize), parseQueueSearch(query.query));
  }
  @Post('warehouse/shipments/orders/:orderId/claim') claimShipmentWork(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.warehouse(req); return this.service.claimShipmentWork(req.principal.id, orderId, body); }
  @Post('warehouse/shipments/orders/:orderId/release') releaseShipmentWork(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.warehouse(req); return this.service.releaseShipmentWork(req.principal.id, orderId, body); }
  @Post('warehouse/shipments/orders/:orderId/pick') pickShipmentWork(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.warehouse(req); return this.service.setPickedQuantities(req.principal.id, orderId, body); }
  @Post('warehouse/shipments/orders/:orderId/inspect') inspectShipmentWork(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.warehouse(req); return this.service.setInspectedQuantities(req.principal.id, orderId, body); }
  @Post('warehouse/shipments') ship(@Req() req: SessionRequest, @Body() body: unknown) { this.warehouse(req); return this.service.ship(req.principal.id, body); }
  @Get('warehouse/deliveries') deliveries(@Req() req: SessionRequest) { this.warehouse(req); return this.service.deliveries(); }
  @Post('warehouse/deliveries/:shipmentId/schedule') scheduleDelivery(@Req() req: SessionRequest,@Param('shipmentId') id:string,@Body() body:unknown){this.warehouse(req);return this.service.updateDelivery(req.principal.id,id,'schedule',body)}
  @Post('warehouse/deliveries/:shipmentId/dispatch') dispatchDelivery(@Req() req: SessionRequest,@Param('shipmentId') id:string,@Body() body:unknown){this.warehouse(req);return this.service.updateDelivery(req.principal.id,id,'dispatch',body)}
  @Post('warehouse/deliveries/:shipmentId/deliver') deliver(@Req() req: SessionRequest,@Param('shipmentId') id:string,@Body() body:unknown){this.warehouse(req);return this.service.updateDelivery(req.principal.id,id,'deliver',body)}
  @Post('warehouse/deliveries/:shipmentId/fail') failDelivery(@Req() req: SessionRequest,@Param('shipmentId') id:string,@Body() body:unknown){this.warehouse(req);return this.service.updateDelivery(req.principal.id,id,'fail',body)}
  @Get('admin/orders/history') adminHistory(@Req() req: SessionRequest, @Query() query:Record<string,string|undefined>) { this.operator(req); return this.service.adminOrderHistory(parsePagination(query.page,query.pageSize),parseOrderFilters(query.query,query.status,query.from,query.to,['submitted','in_progress','completed','cancelled'])); }
  @Get('admin/orders') pending(@Req() req: SessionRequest, @Query() query:Record<string,string|undefined>) { this.operator(req); return this.service.pending(parsePagination(query.page,query.pageSize),parseOrderFilters(query.query,query.status,query.from,query.to,['submitted','confirmed'])); }
  @Post('admin/orders/:orderId/confirm') confirm(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.operator(req); return this.service.confirm(req.principal.id, orderId, body); }
  @Post('admin/orders/:orderId/allocate') allocate(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.operator(req); return this.service.allocate(req.principal.id, orderId, body); }
  @Post('admin/orders/:orderId/cancel') cancel(@Req() req: SessionRequest, @Param('orderId') orderId: string, @Body() body: unknown) { this.operator(req); return this.service.cancel(req.principal.id, orderId, body); }
  @Post('admin/order-cancellation-requests/:requestId/approve') approveCancellation(@Req() req: SessionRequest, @Param('requestId') requestId: string, @Body() body: unknown) { this.operator(req); return this.service.reviewCancellation(req.principal.id, requestId, 'approved', body); }
  @Post('admin/order-cancellation-requests/:requestId/reject') rejectCancellation(@Req() req: SessionRequest, @Param('requestId') requestId: string, @Body() body: unknown) { this.operator(req); return this.service.reviewCancellation(req.principal.id, requestId, 'rejected', body); }
}
