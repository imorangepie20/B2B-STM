import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SessionRequest } from '../identity/session.guard';
import { parsePagination } from '../orders/pagination';
import { parseQueueSearch } from '../orders/queue-search';
@Controller('admin') export class CatalogController { constructor(private readonly service:CatalogService) {} private allowed(req:SessionRequest){if(!req.principal.mfaVerified||!req.principal.roles.some(role=>role==='system'||role==='operations')) throw new ForbiddenException('Administrator MFA required');}
  @Post('catalog/suppliers') supplier(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.supplier(body)}
  @Post('catalog/warehouses') warehouse(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.warehouse(body)}
  @Post('catalog/customers') customer(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.customer(body)}
  @Post('catalog/products') product(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.product(body)}
  @Post('catalog/customer-prices') customerPrice(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.customerPrice(body)}
  @Post('catalog/customers/:id') updateCustomer(@Req() req:SessionRequest,@Param('id') id:string,@Body() body:unknown){this.allowed(req);return this.service.updateCustomer(id,body)}
  @Post('catalog/products/:id') updateProduct(@Req() req:SessionRequest,@Param('id') id:string,@Body() body:unknown){this.allowed(req);return this.service.updateProduct(id,body)}
  @Post('catalog/customer-prices/deactivate') deactivateCustomerPrice(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.deactivateCustomerPrice(body)}
  @Get('catalog/customer-prices') customerPriceList(@Req() req:SessionRequest,@Query('customerId') customerId?:string){this.allowed(req);return this.service.customerPriceList(customerId)}
  @Post('catalog/customers/:id/deactivate') deactivateCustomer(@Req() req:SessionRequest,@Param('id') id:string){this.allowed(req);return this.service.deactivate('customers',id)}
  @Post('catalog/products/:id/deactivate') deactivateProduct(@Req() req:SessionRequest,@Param('id') id:string){this.allowed(req);return this.service.deactivate('products',id)}
  @Get('catalog') catalog(@Req() req:SessionRequest){this.allowed(req);return this.service.lists()}
  @Get('dashboard') dashboard(@Req() req:SessionRequest,@Query('days') value?:string){
    this.allowed(req);
    const days=value===undefined?7:Number(value);
    if(![7,30,90].includes(days))throw new BadRequestException('Dashboard period must be 7, 30, or 90 days');
    return this.service.dashboard(days);
  }
  @Get('inventory') inventory(@Req() req:SessionRequest,@Query() query:Record<string,string|undefined>){
    this.allowed(req);
    if(query.page===undefined&&query.pageSize===undefined&&query.query===undefined)return this.service.inventory();
    return this.service.inventory(parsePagination(query.page,query.pageSize),parseQueueSearch(query.query));
  }
  @Post('inventory/adjustments') adjustment(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.adjustment(req.principal.id,body)}
  @Post('receipts') receipt(@Req() req:SessionRequest,@Body() body:unknown){this.allowed(req);return this.service.receipt(req.principal.id,body)} }
