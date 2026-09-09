import { BadRequestException, Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import { SessionRequest } from '../identity/session.guard';
import { AnalyticsService } from './analytics.service';

const period = (value?: string) => {
  const days = value === undefined ? 30 : Number(value);
  if (![7,30,90].includes(days)) throw new BadRequestException('Analytics period must be 7, 30, or 90 days');
  return days;
};

@Controller()
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Get('warehouse/analytics') warehouse(@Req() req: SessionRequest, @Query('days') value?: string) {
    if (!req.principal.roles.includes('warehouse') && !(req.principal.roles.includes('system') && req.principal.mfaVerified)) throw new ForbiddenException('Warehouse role required');
    return this.service.warehouse(period(value));
  }
  @Get('analytics') customer(@Req() req: SessionRequest, @Query('days') value?: string) {
    if (!req.principal.customerId || !req.principal.roles.includes('customer')) throw new ForbiddenException('Customer account required');
    return this.service.customer(req.principal.customerId,period(value));
  }
}
