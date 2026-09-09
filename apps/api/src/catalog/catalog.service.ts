import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DATABASE } from '../database';
import { pageResult, Pagination } from '../orders/pagination';

const code = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '';
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly pool: Pool) {}
  private async create(table: 'suppliers'|'warehouses', body: any) {
    const itemCode=code(body?.code), name=text(body?.name); if (!itemCode || !name) throw new BadRequestException('Code and name are required');
    try { const result=await this.pool.query(`INSERT INTO ${table}(id,code,name) VALUES ($1,$2,$3) RETURNING id,code,name,active`,[randomUUID(),itemCode,name]); return result.rows[0]; }
    catch (error:any) { if (error?.code==='23505') throw new ConflictException('Code already exists'); throw new ServiceUnavailableException('Catalog unavailable'); }
  }
  supplier(body: unknown) { return this.create('suppliers',body); }
  warehouse(body: unknown) { return this.create('warehouses',body); }
  async customer(body:any) { const customerCode=code(body?.code),name=text(body?.name),paymentDueDay=Number(body?.paymentDueDay??10); if(!customerCode||!name||!Number.isInteger(paymentDueDay)||paymentDueDay<1||paymentDueDay>31) throw new BadRequestException('Customer code, name and payment due day are required'); try{return (await this.pool.query('INSERT INTO customers(id,code,name,payment_due_day) VALUES ($1,$2,$3,$4) RETURNING id,code,name,payment_due_day AS "paymentDueDay",active',[randomUUID(),customerCode,name,paymentDueDay])).rows[0];}catch(error:any){if(error?.code==='23505')throw new ConflictException('Customer code already exists');throw new ServiceUnavailableException('Catalog unavailable');} }
  async product(body: any) { const sku=code(body?.sku), name=text(body?.name), saleUnit=text(body?.saleUnit); if (!sku||!name||!saleUnit) throw new BadRequestException('SKU, name and sale unit are required'); try { return (await this.pool.query('INSERT INTO products(id,sku,name,sale_unit) VALUES ($1,$2,$3,$4) RETURNING id,sku,name,sale_unit AS "saleUnit",active,version',[randomUUID(),sku,name,saleUnit])).rows[0]; } catch(error:any) { if(error?.code==='23505') throw new ConflictException('SKU already exists'); throw new ServiceUnavailableException('Catalog unavailable'); } }
  async customerPrice(body:any) { const customerId=text(body?.customerId),productId=text(body?.productId),unitPrice=Number(body?.unitPrice),taxCategory=body?.taxCategory,taxRateBps=Number(body?.taxRateBps); if(!uuid.test(customerId)||!uuid.test(productId)||!Number.isSafeInteger(unitPrice)||unitPrice<0||!['taxable','exempt'].includes(taxCategory)||!Number.isInteger(taxRateBps)||taxRateBps<0||taxRateBps>10000||(taxCategory==='exempt'&&taxRateBps!==0)||(taxCategory==='taxable'&&taxRateBps===0)) throw new BadRequestException('Customer price is invalid'); try{return (await this.pool.query('INSERT INTO customer_prices(customer_id,product_id,unit_price,tax_category,tax_rate_bps,active,version,updated_at) VALUES ($1,$2,$3,$4,$5,true,1,now()) ON CONFLICT(customer_id,product_id) DO UPDATE SET unit_price=EXCLUDED.unit_price,tax_category=EXCLUDED.tax_category,tax_rate_bps=EXCLUDED.tax_rate_bps,active=true,version=customer_prices.version+1,updated_at=now() RETURNING customer_id AS "customerId",product_id AS "productId",unit_price AS "unitPrice",tax_category AS "taxCategory",tax_rate_bps AS "taxRateBps",version',[customerId,productId,unitPrice,taxCategory,taxRateBps])).rows[0];}catch(error:any){if(error?.code==='23503')throw new BadRequestException('Customer or product unavailable');throw new ServiceUnavailableException('Customer price unavailable');} }
  async updateCustomer(id:string,body:any){const name=text(body?.name),paymentDueDay=Number(body?.paymentDueDay);if(!uuid.test(id)||!name||!Number.isInteger(paymentDueDay)||paymentDueDay<1||paymentDueDay>31)throw new BadRequestException('Customer name and payment due day are required');try{const result=await this.pool.query('UPDATE customers SET name=$2,payment_due_day=$3 WHERE id=$1 AND active RETURNING id,code,name,payment_due_day AS "paymentDueDay",active',[id,name,paymentDueDay]);if(!result.rowCount)throw new ConflictException('Active customer unavailable');return result.rows[0];}catch(error){if(error instanceof BadRequestException||error instanceof ConflictException)throw error;throw new ServiceUnavailableException('Customer unavailable');}}
  async updateProduct(id:string,body:any){const name=text(body?.name),saleUnit=text(body?.saleUnit);if(!uuid.test(id)||!name||!saleUnit)throw new BadRequestException('Product name and sale unit are required');try{const result=await this.pool.query('UPDATE products SET name=$2,sale_unit=$3,version=version+1,updated_at=now() WHERE id=$1 AND active RETURNING id,sku,name,sale_unit AS "saleUnit",active,version',[id,name,saleUnit]);if(!result.rowCount)throw new ConflictException('Active product unavailable');return result.rows[0];}catch(error){if(error instanceof BadRequestException||error instanceof ConflictException)throw error;throw new ServiceUnavailableException('Product unavailable');}}
  async deactivateCustomerPrice(body:any){const customerId=text(body?.customerId),productId=text(body?.productId);if(!uuid.test(customerId)||!uuid.test(productId))throw new BadRequestException('Customer price is invalid');try{const result=await this.pool.query('UPDATE customer_prices SET active=false,version=version+1,updated_at=now() WHERE customer_id=$1 AND product_id=$2 AND active RETURNING customer_id AS "customerId",product_id AS "productId",active,version',[customerId,productId]);if(!result.rowCount)throw new ConflictException('Active customer price unavailable');return result.rows[0];}catch(error){if(error instanceof BadRequestException||error instanceof ConflictException)throw error;throw new ServiceUnavailableException('Customer price unavailable');}}
  async customerPriceList(customerId?:string){if(customerId!==undefined&&!uuid.test(customerId))throw new BadRequestException('Invalid customer ID');try{return (await this.pool.query(`SELECT cp.customer_id AS "customerId",c.code AS "customerCode",c.name AS "customerName",c.payment_due_day AS "paymentDueDay",cp.product_id AS "productId",p.sku,p.name AS "productName",p.sale_unit AS "saleUnit",cp.unit_price AS "unitPrice",cp.tax_category AS "taxCategory",cp.tax_rate_bps AS "taxRateBps",cp.active,cp.version,cp.updated_at AS "updatedAt" FROM customer_prices cp JOIN customers c ON c.id=cp.customer_id JOIN products p ON p.id=cp.product_id WHERE ($1::uuid IS NULL OR cp.customer_id=$1) ORDER BY c.code,p.sku`,[customerId??null])).rows;}catch(error){if(error instanceof BadRequestException)throw error;throw new ServiceUnavailableException('Customer price unavailable');}}
  async dashboard(days=7){try{
    const [period,fulfillment,inventory,settlement,queues,payments,daily,topProducts,inventoryByWarehouse,lowStockProducts,returnReasons,monthlyFinance,topDebtors]=await Promise.all([
      this.pool.query(`SELECT
        count(*) FILTER(WHERE source='order')::int AS orders,
        count(*) FILTER(WHERE source='shipment')::int AS shipments,
        COALESCE(sum(amount) FILTER(WHERE entry_type='shipment'),0)::bigint AS "grossSalesAmount",
        abs(COALESCE(sum(amount) FILTER(WHERE entry_type='return_credit'),0))::bigint AS "returnDeductionAmount",
        COALESCE(sum(amount),0)::bigint AS "netSalesAmount",
        count(*) FILTER(WHERE source='order' AND status='submitted')::int AS submitted,
        count(*) FILTER(WHERE source='order' AND status='confirmed')::int AS confirmed,
        count(*) FILTER(WHERE source='order' AND status='rejected')::int AS rejected
        FROM (
          SELECT 'order'::text AS source,o.status,NULL::text AS entry_type,NULL::bigint AS amount FROM orders o WHERE o.created_at>=current_date-($1::int-1)*interval '1 day'
          UNION ALL SELECT 'shipment',s.status,NULL,NULL FROM shipments s WHERE s.shipped_at>=current_date-($1::int-1)*interval '1 day'
          UNION ALL SELECT 'ledger',NULL,re.entry_type,re.amount FROM receivable_entries re WHERE re.business_date>=current_date-($1::int-1)
        ) activity`,[days]),
      this.pool.query(`SELECT COALESCE(sum(ol.requested_quantity),0)::int AS "requestedQuantity",
        COALESCE(sum((SELECT COALESCE(sum(sl.quantity),0) FROM reservations r JOIN shipment_lines sl ON sl.reservation_id=r.id WHERE r.order_line_id=ol.id)),0)::int AS "shippedQuantity"
        FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE o.created_at>=current_date-($1::int-1)*interval '1 day'`,[days]),
      this.pool.query(`SELECT COALESCE(sum(on_hand_quantity),0)::int AS "onHandQuantity",COALESCE(sum(reserved_quantity),0)::int AS "reservedQuantity",COALESCE(sum(on_hand_quantity-reserved_quantity),0)::int AS "availableQuantity",count(DISTINCT product_id) FILTER(WHERE on_hand_quantity-reserved_quantity<=0)::int AS "lowStockProducts" FROM inventory_balances`),
      this.pool.query(`SELECT
        COALESCE((SELECT sum(sl.amount) FROM settlement_lines sl JOIN settlements s ON s.id=sl.settlement_id WHERE s.status='finalized'),0)::bigint AS "billedAmount",
        COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa JOIN settlements s ON s.id=pa.settlement_id LEFT JOIN payment_allocation_reversals pr ON pr.payment_allocation_id=pa.id WHERE s.status='finalized' AND pr.id IS NULL),0)::bigint AS "collectedAmount"`),
      this.pool.query(`SELECT (SELECT count(*)::int FROM orders WHERE status='submitted') AS "pendingOrders",(SELECT count(*)::int FROM return_lines WHERE received_quantity<requested_quantity) AS "pendingReturns"`),
      this.pool.query(`SELECT COALESCE(sum(p.amount-COALESCE(a.amount,0)-COALESCE(r.amount,0)),0)::bigint AS amount FROM payments p LEFT JOIN LATERAL (SELECT sum(pa.amount) AS amount FROM payment_allocations pa LEFT JOIN payment_allocation_reversals pr ON pr.payment_allocation_id=pa.id WHERE pa.payment_id=p.id AND pr.id IS NULL) a ON true LEFT JOIN LATERAL (SELECT sum(rf.amount) AS amount FROM refunds rf WHERE rf.payment_id=p.id) r ON true WHERE p.status='recorded'`),
      this.pool.query(`WITH dates AS (
        SELECT generate_series(current_date-($1::int-1),current_date,interval '1 day')::date AS date
      ), order_daily AS (
        SELECT created_at::date AS date,count(*)::int AS orders FROM orders
        WHERE created_at>=current_date-($1::int-1)*interval '1 day' GROUP BY created_at::date
      ), shipment_daily AS (
        SELECT shipped_at::date AS date,count(*)::int AS shipments FROM shipments
        WHERE shipped_at>=current_date-($1::int-1)*interval '1 day' GROUP BY shipped_at::date
      ), ledger_daily AS (
        SELECT business_date AS date,
          COALESCE(sum(amount) FILTER(WHERE entry_type='shipment'),0)::bigint AS gross,
          abs(COALESCE(sum(amount) FILTER(WHERE entry_type='return_credit'),0))::bigint AS returns,
          COALESCE(sum(amount),0)::bigint AS net
        FROM receivable_entries WHERE business_date>=current_date-($1::int-1) GROUP BY business_date
      ) SELECT to_char(d.date,'YYYY-MM-DD') AS date,COALESCE(o.orders,0)::int AS orders,
        COALESCE(s.shipments,0)::int AS shipments,COALESCE(l.gross,0)::bigint AS "grossSalesAmount",
        COALESCE(l.returns,0)::bigint AS "returnDeductionAmount",COALESCE(l.net,0)::bigint AS "netSalesAmount"
      FROM dates d LEFT JOIN order_daily o USING(date) LEFT JOIN shipment_daily s USING(date)
      LEFT JOIN ledger_daily l USING(date) ORDER BY d.date`,[days]),
      this.pool.query(`SELECT ol.sku,ol.product_name AS name,
        COALESCE(sum(sl.quantity),0)::int AS "shippedQuantity",COALESCE(sum(re.amount),0)::bigint AS "netSalesAmount"
      FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id JOIN reservations r ON r.id=sl.reservation_id
      JOIN order_lines ol ON ol.id=r.order_line_id LEFT JOIN receivable_entries re ON re.shipment_line_id=sl.id
      WHERE s.shipped_at>=current_date-($1::int-1)*interval '1 day'
      GROUP BY ol.sku,ol.product_name ORDER BY "netSalesAmount" DESC,"shippedQuantity" DESC,ol.sku LIMIT 8`,[days]),
      this.pool.query(`SELECT w.code AS "warehouseCode",w.name AS "warehouseName",
        COALESCE(sum(b.on_hand_quantity),0)::int AS "onHandQuantity",
        COALESCE(sum(b.reserved_quantity),0)::int AS "reservedQuantity",
        COALESCE(sum(b.on_hand_quantity-b.reserved_quantity),0)::int AS "availableQuantity"
      FROM warehouses w LEFT JOIN inventory_balances b ON b.warehouse_id=w.id WHERE w.active
      GROUP BY w.id,w.code,w.name ORDER BY w.code`),
      this.pool.query(`SELECT w.code AS "warehouseCode",p.sku,p.name,
        b.on_hand_quantity AS "onHandQuantity",b.reserved_quantity AS "reservedQuantity",
        b.on_hand_quantity-b.reserved_quantity AS "availableQuantity"
      FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN products p ON p.id=b.product_id
      ORDER BY "availableQuantity",b.reserved_quantity DESC,p.sku LIMIT 8`),
      this.pool.query(`SELECT rl.reason,count(DISTINCT r.id)::int AS returns,
        COALESCE(sum(rl.requested_quantity),0)::int AS "requestedQuantity",
        COALESCE(sum(rl.normal_quantity),0)::int AS "normalQuantity",
        COALESCE(sum(rl.defective_quantity),0)::int AS "defectiveQuantity"
      FROM returns r JOIN return_lines rl ON rl.return_id=r.id
      WHERE r.requested_at>=current_date-($1::int-1)*interval '1 day'
      GROUP BY rl.reason ORDER BY "requestedQuantity" DESC,rl.reason LIMIT 8`,[days]),
      this.pool.query(`WITH months AS (
        SELECT generate_series(date_trunc('month',current_date)-interval '5 months',date_trunc('month',current_date),interval '1 month')::date AS month
      ), billed AS (
        SELECT s.period AS month,COALESCE(sum(sl.amount),0)::bigint AS amount FROM settlements s
        JOIN settlement_lines sl ON sl.settlement_id=s.id WHERE s.status='finalized' GROUP BY s.period
      ), collected AS (
        SELECT s.period AS month,COALESCE(sum(pa.amount),0)::bigint AS amount FROM settlements s
        JOIN payment_allocations pa ON pa.settlement_id=s.id LEFT JOIN payment_allocation_reversals pr ON pr.payment_allocation_id=pa.id
        WHERE s.status='finalized' AND pr.id IS NULL GROUP BY s.period
      ) SELECT to_char(m.month,'YYYY-MM') AS month,COALESCE(b.amount,0)::bigint AS "billedAmount",
        COALESCE(c.amount,0)::bigint AS "collectedAmount",GREATEST(COALESCE(b.amount,0)-COALESCE(c.amount,0),0)::bigint AS "outstandingAmount"
      FROM months m LEFT JOIN billed b USING(month) LEFT JOIN collected c USING(month) ORDER BY m.month`),
      this.pool.query(`WITH billed AS (
        SELECT s.customer_id,sum(sl.amount)::bigint AS amount FROM settlements s JOIN settlement_lines sl ON sl.settlement_id=s.id
        WHERE s.status='finalized' GROUP BY s.customer_id
      ), collected AS (
        SELECT s.customer_id,sum(pa.amount)::bigint AS amount FROM settlements s JOIN payment_allocations pa ON pa.settlement_id=s.id
        LEFT JOIN payment_allocation_reversals pr ON pr.payment_allocation_id=pa.id
        WHERE s.status='finalized' AND pr.id IS NULL GROUP BY s.customer_id
      ) SELECT c.code AS "customerCode",c.name AS "customerName",b.amount::bigint AS "billedAmount",
        COALESCE(p.amount,0)::bigint AS "collectedAmount",GREATEST(b.amount-COALESCE(p.amount,0),0)::bigint AS "outstandingAmount"
      FROM billed b JOIN customers c ON c.id=b.customer_id LEFT JOIN collected p ON p.customer_id=b.customer_id
      ORDER BY "outstandingAmount" DESC,c.code LIMIT 8`),
    ]);
    const activity=period.rows[0],flow=fulfillment.rows[0],stock=inventory.rows[0],receivables=settlement.rows[0],queue=queues.rows[0];
    const requested=Number(flow.requestedQuantity),shipped=Number(flow.shippedQuantity),onHand=Number(stock.onHandQuantity),reserved=Number(stock.reservedQuantity),billed=Number(receivables.billedAmount),collected=Number(receivables.collectedAmount);
    return{
      days,generatedAt:new Date().toISOString(),
      period:{orders:activity.orders,shipments:activity.shipments,grossSalesAmount:activity.grossSalesAmount,returnDeductionAmount:activity.returnDeductionAmount,netSalesAmount:activity.netSalesAmount},
      orderStatus:{submitted:activity.submitted,confirmed:activity.confirmed,rejected:activity.rejected},
      fulfillment:{requestedQuantity:requested,shippedQuantity:shipped,rate:requested?Math.min(100,Math.round(shipped/requested*100)):0},
      inventory:{onHandQuantity:onHand,reservedQuantity:reserved,availableQuantity:Number(stock.availableQuantity),reservationRate:onHand?Math.min(100,Math.round(reserved/onHand*100)):0},
      settlement:{billedAmount:String(receivables.billedAmount),collectedAmount:String(receivables.collectedAmount),outstandingAmount:String(Math.max(0,billed-collected)),collectionRate:billed>0?Math.min(100,Math.round(collected/billed*100)):0},
      pendingOrders:queue.pendingOrders,lowStockProducts:stock.lowStockProducts,pendingReturns:queue.pendingReturns,unallocatedPaymentAmount:String(payments.rows[0].amount),
      daily:daily.rows,topProducts:topProducts.rows,inventoryByWarehouse:inventoryByWarehouse.rows,
      lowStockProductsList:lowStockProducts.rows,returnReasons:returnReasons.rows,monthlyFinance:monthlyFinance.rows,topDebtors:topDebtors.rows,
    };
  }catch(error){if(error instanceof BadRequestException)throw error;throw new ServiceUnavailableException('Dashboard unavailable');}}
  async deactivate(table:'customers'|'products',id:string){if(!uuid.test(id))throw new BadRequestException('Invalid ID');try{const result=await this.pool.query(`UPDATE ${table} SET active=false WHERE id=$1 AND active RETURNING id`,[id]);if(!result.rowCount)throw new ConflictException('Active record unavailable');return{ id,status:'inactive'};}catch(error){if(error instanceof BadRequestException||error instanceof ConflictException)throw error;throw new ServiceUnavailableException('Catalog unavailable');}}
  async inventory(pagination?:Pagination,query='') { try {
    const select=`SELECT b.warehouse_id AS "warehouseId",b.product_id AS "productId",w.code AS "warehouseCode",p.sku,p.name,p.sale_unit AS "saleUnit",b.on_hand_quantity AS "onHandQuantity",b.reserved_quantity AS "reservedQuantity",b.on_hand_quantity-b.reserved_quantity AS "availableQuantity",EXISTS(SELECT 1 FROM stock_counts sc WHERE sc.warehouse_id=b.warehouse_id AND sc.product_id=b.product_id AND sc.status='counting') AS "stockCountActive" FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN products p ON p.id=b.product_id`;
    if(!pagination)return(await this.pool.query(`${select} ORDER BY w.code,p.sku`)).rows;
    const values:unknown[]=[],where=query?(()=>{values.push(`%${query}%`);return` WHERE w.code ILIKE $1 OR p.sku ILIKE $1 OR p.name ILIKE $1`;})():'';
    const[count,items]=await Promise.all([
      this.pool.query(`SELECT count(*)::int AS total FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN products p ON p.id=b.product_id${where}`,values),
      this.pool.query(`${select}${where} ORDER BY w.code,p.sku LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]),
    ]);
    return pageResult(items.rows,count.rows[0].total,pagination);
  } catch { throw new ServiceUnavailableException('Inventory unavailable'); } }
  async lists() { try { const [customers,suppliers,warehouses,products]=await Promise.all([this.pool.query('SELECT id,code,name,payment_due_day AS "paymentDueDay" FROM customers WHERE active ORDER BY code'),this.pool.query('SELECT id,code,name FROM suppliers WHERE active ORDER BY code'),this.pool.query('SELECT id,code,name FROM warehouses WHERE active ORDER BY code'),this.pool.query('SELECT id,sku,name,sale_unit AS "saleUnit" FROM products WHERE active ORDER BY sku')]); return {customers:customers.rows,suppliers:suppliers.rows,warehouses:warehouses.rows,products:products.rows}; } catch { throw new ServiceUnavailableException('Catalog unavailable'); } }
  async adjustment(actorId:string, body:any) { const requestId=text(body?.requestId),warehouseId=text(body?.warehouseId),productId=text(body?.productId),quantityDelta=Number(body?.quantityDelta),reason=text(body?.reason); if(!uuid.test(requestId)||!uuid.test(warehouseId)||!uuid.test(productId)||!Number.isInteger(quantityDelta)||!quantityDelta||!reason) throw new BadRequestException('Inventory adjustment is invalid'); const db=await this.pool.connect(); try { await db.query('BEGIN'); await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actorId}:inventory.adjust:${requestId}`]); const existing=await db.query("SELECT response FROM command_results WHERE actor_id=$1 AND command_type='inventory.adjust' AND request_id=$2",[actorId,requestId]); if(existing.rowCount){await db.query('COMMIT');return existing.rows[0].response} const balance=await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE',[warehouseId,productId]); if(!balance.rowCount) throw new BadRequestException('Inventory balance unavailable'); if((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[warehouseId,productId])).rowCount)throw new ConflictException('SKU is under stock count'); const next=balance.rows[0].on_hand_quantity+quantityDelta; if(next<balance.rows[0].reserved_quantity) throw new ConflictException('Adjustment would reduce reserved inventory'); const id=randomUUID(); await db.query('INSERT INTO inventory_adjustments(id,warehouse_id,product_id,quantity_delta,reason,adjusted_by) VALUES ($1,$2,$3,$4,$5,$6)',[id,warehouseId,productId,quantityDelta,reason,actorId]); await db.query('UPDATE inventory_balances SET on_hand_quantity=$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2',[warehouseId,productId,next]); await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,adjustment_id,created_by) VALUES ($1,$2,$3,'adjustment',$4,$5,$6)",[randomUUID(),warehouseId,productId,quantityDelta,id,actorId]); const response={id,quantityDelta,onHandQuantity:next,reservedQuantity:balance.rows[0].reserved_quantity}; await db.query("INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,'inventory.adjust',$2,$3)",[actorId,requestId,JSON.stringify(response)]); await db.query('COMMIT'); return response; } catch(error:any) { await db.query('ROLLBACK').catch(()=>{}); if(error instanceof BadRequestException||error instanceof ConflictException) throw error; throw new ServiceUnavailableException('Inventory adjustment unavailable'); } finally { db.release(); } }
  async receipt(actorId:string, body:any) { const requestId=text(body?.requestId),supplierId=text(body?.supplierId),warehouseId=text(body?.warehouseId),lines=Array.isArray(body?.lines)?body.lines:[]; if(!uuid.test(requestId)||!uuid.test(supplierId)||!uuid.test(warehouseId)||!lines.length) throw new BadRequestException('Supplier, warehouse and receipt lines are required'); const db=await this.pool.connect(); try { await db.query('BEGIN'); await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actorId}:receipt.confirm:${requestId}`]); const existing=await db.query("SELECT response FROM command_results WHERE actor_id=$1 AND command_type='receipt.confirm' AND request_id=$2",[actorId,requestId]); if(existing.rowCount){await db.query('COMMIT');return existing.rows[0].response} const receiptId=randomUUID(); await db.query("INSERT INTO receipts(id,supplier_id,warehouse_id,status,received_at,created_by) VALUES ($1,$2,$3,'confirmed',now(),$4)",[receiptId,supplierId,warehouseId,actorId]); for(const line of lines){const productId=text(line?.productId), quantity=Number(line?.quantity); if(!uuid.test(productId)||!Number.isInteger(quantity)||quantity<1) throw new BadRequestException('Receipt line is invalid'); await db.query('SELECT product_id FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE',[warehouseId,productId]); if((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[warehouseId,productId])).rowCount)throw new ConflictException('SKU is under stock count'); const lineId=randomUUID(); await db.query('INSERT INTO receipt_lines(id,receipt_id,product_id,quantity) VALUES ($1,$2,$3,$4)',[lineId,receiptId,productId,quantity]); await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity) VALUES ($1,$2,$3) ON CONFLICT(warehouse_id,product_id) DO UPDATE SET on_hand_quantity=inventory_balances.on_hand_quantity+EXCLUDED.on_hand_quantity,version=inventory_balances.version+1,updated_at=now()',[warehouseId,productId,quantity]); await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,receipt_line_id,created_by) VALUES ($1,$2,$3,'receipt',$4,$5,$6)",[randomUUID(),warehouseId,productId,quantity,lineId,actorId]); } const response={id:receiptId,status:'confirmed'}; await db.query("INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,'receipt.confirm',$2,$3)",[actorId,requestId,JSON.stringify(response)]); await db.query('COMMIT'); return response; } catch(error:any) { await db.query('ROLLBACK').catch(()=>{}); if(error instanceof BadRequestException||error instanceof ConflictException) throw error; if(error?.code==='23503'||error?.code==='23505') throw new BadRequestException('Receipt references are invalid'); throw new ServiceUnavailableException('Receipt unavailable'); } finally { db.release(); } }
}
