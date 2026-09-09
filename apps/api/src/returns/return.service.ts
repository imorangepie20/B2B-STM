import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';
import { pageResult, Pagination } from '../orders/pagination';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
type ReturnRequest = { requestId: string; lines: { shipmentLineId: string; quantity: number; reason: string }[] };
type Inspection = { requestId: string; receivedQuantity: number; normalQuantity: number; defectiveQuantity: number; defectiveReason: string | null };

@Injectable()
export class ReturnService {
  constructor(@Inject(DATABASE) private readonly pool: Pool) {}

  private requestInput(body: unknown): ReturnRequest {
    const value = body as { requestId?: unknown; lines?: unknown } | null;
    const lines = Array.isArray(value?.lines) ? value.lines.map(line => ({ shipmentLineId: text((line as { shipmentLineId?: unknown })?.shipmentLineId), quantity: Number((line as { quantity?: unknown })?.quantity), reason: text((line as { reason?: unknown })?.reason) })) : [];
    const requestId = text(value?.requestId);
    if (!uuid.test(requestId) || !lines.length || lines.some(line => !uuid.test(line.shipmentLineId) || !Number.isInteger(line.quantity) || line.quantity < 1 || !line.reason) || new Set(lines.map(line => line.shipmentLineId)).size !== lines.length) throw new BadRequestException('Invalid return request');
    return { requestId, lines };
  }

  private inspection(body: unknown): Inspection {
    const value = body as { requestId?: unknown; receivedQuantity?: unknown; normalQuantity?: unknown; defectiveQuantity?: unknown; defectiveReason?: unknown } | null;
    const requestId = text(value?.requestId), receivedQuantity = Number(value?.receivedQuantity), normalQuantity = Number(value?.normalQuantity), defectiveQuantity = Number(value?.defectiveQuantity);
    const defectiveReason = text(value?.defectiveReason) || null;
    if (!uuid.test(requestId) || !Number.isInteger(receivedQuantity) || !Number.isInteger(normalQuantity) || !Number.isInteger(defectiveQuantity) || receivedQuantity < 1 || normalQuantity < 0 || defectiveQuantity < 0 || normalQuantity + defectiveQuantity !== receivedQuantity || (defectiveQuantity > 0 && !defectiveReason) || (defectiveQuantity === 0 && defectiveReason)) throw new BadRequestException('Invalid return inspection');
    return { requestId, receivedQuantity, normalQuantity, defectiveQuantity, defectiveReason };
  }

  private async transaction<T>(work: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect().catch(() => { throw new ServiceUnavailableException('Return service unavailable'); });
    try { await db.query('BEGIN'); const result = await work(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK').catch(() => {}); if (error instanceof HttpException) throw error; throw new ServiceUnavailableException('Return service unavailable'); }
    finally { db.release(); }
  }

  private async stored(db: PoolClient, actorId: string, commandType: string, requestId: string) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actorId}:${commandType}:${requestId}`]);
    return (await db.query('SELECT response FROM command_results WHERE actor_id=$1 AND command_type=$2 AND request_id=$3', [actorId, commandType, requestId])).rows[0]?.response as unknown | undefined;
  }

  async shipmentLines(customerId: string) {
    try {
      return (await this.pool.query(`SELECT sl.id AS "shipmentLineId",s.id AS "shipmentId",p.sku,p.name AS "productName",sl.quantity AS "shippedQuantity",
        COALESCE((SELECT sum(rl.requested_quantity) FROM return_lines rl WHERE rl.shipment_line_id=sl.id),0)::int AS "requestedQuantity"
        FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id JOIN orders o ON o.id=s.order_id JOIN products p ON p.id=(SELECT r.product_id FROM reservations r WHERE r.id=sl.reservation_id)
        WHERE o.customer_id=$1 ORDER BY s.shipped_at DESC,sl.id`, [customerId])).rows;
    } catch { throw new ServiceUnavailableException('Return history unavailable'); }
  }

  async request(customerId: string, actorId: string, body: unknown) {
    const input = this.requestInput(body);
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'return.request', input.requestId);
      if (existing) return existing;
      const rows = new Map<string, any>();
      for (const shipmentLineId of [...input.lines.map(line => line.shipmentLineId)].sort()) {
        const result = await db.query(`SELECT sl.id,sl.quantity,sl.shipment_id,r.product_id,o.customer_id
          FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id JOIN orders o ON o.id=s.order_id JOIN reservations r ON r.id=sl.reservation_id
          WHERE sl.id=$1 FOR UPDATE OF sl`, [shipmentLineId]);
        if (!result.rowCount || result.rows[0].customer_id !== customerId) throw new NotFoundException('Shipment line unavailable');
        rows.set(shipmentLineId, result.rows[0]);
      }
      const shipmentId = rows.values().next().value.shipment_id;
      if ([...rows.values()].some(row => row.shipment_id !== shipmentId)) throw new BadRequestException('Return lines must belong to one shipment');
      for (const line of input.lines) {
        const requested = await db.query('SELECT COALESCE(sum(requested_quantity),0)::int AS quantity FROM return_lines WHERE shipment_line_id=$1', [line.shipmentLineId]);
        if (requested.rows[0].quantity + line.quantity > rows.get(line.shipmentLineId).quantity) throw new ConflictException('Return quantity exceeds shipped quantity');
      }
      const id = randomUUID();
      await db.query("INSERT INTO returns(id,customer_id,shipment_id,status,requested_by) VALUES ($1,$2,$3,'requested',$4)", [id, customerId, shipmentId, actorId]);
      for (const line of input.lines) {
        const shipment = rows.get(line.shipmentLineId)!;
        await db.query('INSERT INTO return_lines(id,return_id,shipment_line_id,product_id,reason,requested_quantity) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, line.shipmentLineId, shipment.product_id, line.reason, line.quantity]);
      }
      const response = { id, status: 'requested' };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,$2,$3,$4)', [actorId, 'return.request', input.requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async queue(pagination?: Pagination, query = '') {
    try {
      if (pagination) {
        const values: unknown[] = [];
        const search = query ? (() => { values.push(`%${query}%`); return ` AND (r.id::text ILIKE $1 OR w.code ILIKE $1 OR c.name ILIKE $1 OR p.sku ILIKE $1 OR p.name ILIKE $1 OR rl.reason ILIKE $1)`; })() : '';
        const from = `FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN shipments s ON s.id=r.shipment_id JOIN warehouses w ON w.id=s.warehouse_id JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=rl.product_id WHERE rl.received_quantity<rl.requested_quantity${search}`;
        const [count, result] = await Promise.all([
          this.pool.query(`SELECT count(*)::int AS total ${from}`, values),
          this.pool.query(`SELECT rl.id AS "returnLineId",r.id AS "returnId",w.id AS "warehouseId",w.code AS "warehouseCode",c.name AS "customerName",p.sku,p.name AS "productName",rl.reason,
            rl.requested_quantity AS "requestedQuantity",rl.received_quantity AS "receivedQuantity",rl.requested_quantity-rl.received_quantity AS "remainingQuantity"
            ${from} ORDER BY r.requested_at,rl.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pagination.pageSize, pagination.offset]),
        ]);
        return pageResult(result.rows, count.rows[0].total, pagination);
      }
      return (await this.pool.query(`SELECT rl.id AS "returnLineId",r.id AS "returnId",w.id AS "warehouseId",w.code AS "warehouseCode",c.name AS "customerName",p.sku,p.name AS "productName",rl.reason,
        rl.requested_quantity AS "requestedQuantity",rl.received_quantity AS "receivedQuantity",rl.requested_quantity-rl.received_quantity AS "remainingQuantity"
        FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN shipments s ON s.id=r.shipment_id JOIN warehouses w ON w.id=s.warehouse_id JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=rl.product_id
        WHERE rl.received_quantity<rl.requested_quantity ORDER BY r.requested_at,rl.id`)).rows;
    } catch { throw new ServiceUnavailableException('Return queue unavailable'); }
  }

  async pendingCredits(pagination?:Pagination,query='') {
    try {
      const select=`SELECT ri.id AS "inspectionId",rl.id AS "returnLineId",c.code AS "customerCode",c.name AS "customerName",p.sku,p.name AS "productName",
        ri.received_quantity AS "inspectedQuantity",ri.normal_quantity AS "normalQuantity",ri.defective_quantity AS "defectiveQuantity",GREATEST(ri.defective_quantity-COALESCE((SELECT sum(d.quantity) FROM return_defect_dispositions d WHERE d.return_inspection_id=ri.id),0),0) AS "unassignedDefectiveQuantity",ri.defective_reason AS "defectiveReason",ol.unit_price AS "originalUnitPrice"
        FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id JOIN customers c ON c.id=r.customer_id
        JOIN products p ON p.id=rl.product_id JOIN shipment_lines sl ON sl.id=rl.shipment_line_id JOIN reservations rs ON rs.id=sl.reservation_id JOIN order_lines ol ON ol.id=rs.order_line_id
        LEFT JOIN return_credits rc ON rc.return_inspection_id=ri.id`;
      if(!pagination)return(await this.pool.query(`${select} WHERE rc.id IS NULL ORDER BY ri.inspected_at,ri.id`)).rows;
      const values:unknown[]=[],search=query?(()=>{values.push(`%${query}%`);return` AND (c.code ILIKE $1 OR c.name ILIKE $1 OR p.sku ILIKE $1 OR p.name ILIKE $1 OR COALESCE(ri.defective_reason,'') ILIKE $1)`;})():'';
      const where=` WHERE rc.id IS NULL${search}`;
      const[count,items]=await Promise.all([
        this.pool.query(`SELECT count(*)::int AS total FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=rl.product_id LEFT JOIN return_credits rc ON rc.return_inspection_id=ri.id${where}`,values),
        this.pool.query(`${select}${where} ORDER BY ri.inspected_at,ri.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]),
      ]);
      return pageResult(items.rows,count.rows[0].total,pagination);
    } catch { throw new ServiceUnavailableException('Return credit queue unavailable'); }
  }

  async defectDisposition(actorId: string, inspectionId: string, body: unknown) {
    if (!uuid.test(inspectionId)) throw new BadRequestException('Invalid return inspection ID');
    const value = body as { requestId?: unknown; quantity?: unknown; disposition?: unknown; reason?: unknown; supplierId?:unknown; reference?:unknown } | null;
    const requestId = text(value?.requestId), quantity = Number(value?.quantity), disposition = text(value?.disposition), reason = text(value?.reason),supplierId=text(value?.supplierId),reference=text(value?.reference);
    if (!uuid.test(requestId) || !Number.isInteger(quantity) || quantity < 1 || !['quarantine', 'disposed','supplier_return'].includes(disposition) || !reason || (disposition==='supplier_return'&&(!uuid.test(supplierId)||!reference))) throw new BadRequestException('Invalid defect disposition');
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'return.defect-disposition', requestId);
      if (existing) return existing;
      const inspection = await db.query('SELECT defective_quantity FROM return_inspections WHERE id=$1 FOR UPDATE', [inspectionId]);
      if (!inspection.rowCount) throw new NotFoundException('Return inspection unavailable');
      const decided = await db.query('SELECT COALESCE(sum(quantity),0)::int AS quantity FROM return_defect_dispositions WHERE return_inspection_id=$1', [inspectionId]);
      if (quantity > inspection.rows[0].defective_quantity - decided.rows[0].quantity) throw new ConflictException('Defect disposition exceeds inspected quantity');
      if(disposition==='supplier_return'&&!(await db.query('SELECT 1 FROM suppliers WHERE id=$1 AND active',[supplierId])).rowCount)throw new NotFoundException('Supplier unavailable');
      await db.query('INSERT INTO return_defect_dispositions(id,return_inspection_id,quantity,disposition,reason,decided_by,supplier_id,external_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), inspectionId, quantity, disposition, reason, actorId,disposition==='supplier_return'?supplierId:null,disposition==='supplier_return'?reference:null]);
      const response = { inspectionId, quantity, disposition };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, 'return.defect-disposition', requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async quarantinedDefects(){try{return(await this.pool.query(`SELECT d.id AS "dispositionId",d.quantity,d.reason,d.created_at AS "quarantinedAt",ri.id AS "inspectionId",c.code AS "customerCode",c.name AS "customerName",p.sku,p.name AS "productName",
    COALESCE((SELECT sum(x.quantity)::int FROM return_defect_resolutions x WHERE x.quarantine_disposition_id=d.id),0) AS "resolvedQuantity",
    d.quantity-COALESCE((SELECT sum(x.quantity)::int FROM return_defect_resolutions x WHERE x.quarantine_disposition_id=d.id),0) AS "remainingQuantity"
    FROM return_defect_dispositions d JOIN return_inspections ri ON ri.id=d.return_inspection_id JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=rl.product_id
    WHERE d.disposition='quarantine' AND d.quantity>COALESCE((SELECT sum(x.quantity) FROM return_defect_resolutions x WHERE x.quarantine_disposition_id=d.id),0) ORDER BY d.created_at,d.id`)).rows}catch{throw new ServiceUnavailableException('Quarantined defects unavailable')}}

  async resolveDefect(actorId:string,dispositionId:string,body:unknown){if(!uuid.test(dispositionId))throw new BadRequestException('Invalid defect disposition ID');const value=body as any,requestId=text(value?.requestId),quantity=Number(value?.quantity),resolution=text(value?.resolution),supplierId=text(value?.supplierId),reference=text(value?.reference),reason=text(value?.reason);if(!uuid.test(requestId)||!Number.isInteger(quantity)||quantity<1||!['disposed','supplier_return'].includes(resolution)||!reason||(resolution==='supplier_return'&&(!uuid.test(supplierId)||!reference)))throw new BadRequestException('Invalid defect resolution');return this.transaction(async db=>{const existing=await this.stored(db,actorId,'return.defect-resolution',requestId);if(existing)return existing;const disposition=await db.query("SELECT id,quantity FROM return_defect_dispositions WHERE id=$1 AND disposition='quarantine' FOR UPDATE",[dispositionId]);if(!disposition.rowCount)throw new NotFoundException('Quarantined defect unavailable');const resolved=Number((await db.query('SELECT COALESCE(sum(quantity),0) AS quantity FROM return_defect_resolutions WHERE quarantine_disposition_id=$1',[dispositionId])).rows[0].quantity);if(quantity>disposition.rows[0].quantity-resolved)throw new ConflictException('Defect resolution exceeds quarantined quantity');if(resolution==='supplier_return'&&!(await db.query('SELECT 1 FROM suppliers WHERE id=$1 AND active',[supplierId])).rowCount)throw new NotFoundException('Supplier unavailable');const id=randomUUID(),response={id,dispositionId,quantity,resolution};await db.query('INSERT INTO return_defect_resolutions(id,quarantine_disposition_id,quantity,resolution,supplier_id,external_reference,reason,resolved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,dispositionId,quantity,resolution,resolution==='supplier_return'?supplierId:null,resolution==='supplier_return'?reference:null,reason,actorId]);await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)',[actorId,'return.defect-resolution',requestId,JSON.stringify(response)]);return response})}

  async inspect(actorId: string, returnLineId: string, body: unknown) {
    if (!uuid.test(returnLineId)) throw new BadRequestException('Invalid return line ID');
    const input = this.inspection(body);
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'return.inspect', input.requestId);
      if (existing) return existing;
      const result = await db.query(`SELECT rl.id,rl.return_id,rl.product_id,rl.requested_quantity,rl.received_quantity,rl.normal_quantity,rl.defective_quantity,s.warehouse_id
        FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN shipments s ON s.id=r.shipment_id WHERE rl.id=$1 FOR UPDATE OF rl,r`, [returnLineId]);
      if (!result.rowCount) throw new NotFoundException('Return line unavailable');
      const line = result.rows[0];
      if (input.receivedQuantity > line.requested_quantity - line.received_quantity) throw new ConflictException('Inspection quantity exceeds remaining return quantity');
      if (input.normalQuantity) {
        await db.query('SELECT product_id FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE',[line.warehouse_id,line.product_id]);
        if((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[line.warehouse_id,line.product_id])).rowCount)throw new ConflictException('SKU is under stock count');
        await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id,product_id) DO UPDATE SET on_hand_quantity=inventory_balances.on_hand_quantity+EXCLUDED.on_hand_quantity,version=inventory_balances.version+1,updated_at=now()', [line.warehouse_id, line.product_id, input.normalQuantity]);
      }
      const inspectionId = randomUUID();
      await db.query('INSERT INTO return_inspections(id,return_line_id,received_quantity,normal_quantity,defective_quantity,defective_reason,inspected_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [inspectionId, returnLineId, input.receivedQuantity, input.normalQuantity, input.defectiveQuantity, input.defectiveReason, actorId]);
      if (input.normalQuantity) await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,return_inspection_id,created_by) VALUES ($1,$2,$3,'return',$4,$5,$6)", [randomUUID(), line.warehouse_id, line.product_id, input.normalQuantity, inspectionId, actorId]);
      await db.query('UPDATE return_lines SET received_quantity=received_quantity+$2,normal_quantity=normal_quantity+$3,defective_quantity=defective_quantity+$4 WHERE id=$1', [returnLineId, input.receivedQuantity, input.normalQuantity, input.defectiveQuantity]);
      const completion = await db.query('SELECT bool_and(received_quantity=requested_quantity) AS complete FROM return_lines WHERE return_id=$1', [line.return_id]);
      const status = completion.rows[0].complete ? 'inspected' : 'inspecting';
      await db.query('UPDATE returns SET status=$2,updated_at=now() WHERE id=$1', [line.return_id, status]);
      const response = { returnLineId, status, receivedQuantity: input.receivedQuantity, normalQuantity: input.normalQuantity, defectiveQuantity: input.defectiveQuantity };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,$2,$3,$4)', [actorId, 'return.inspect', input.requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async credit(actorId: string, inspectionId: string, body: unknown) {
    if (!uuid.test(inspectionId)) throw new BadRequestException('Invalid return inspection ID');
    const value = body as { requestId?: unknown; quantity?: unknown } | null;
    const requestId = text(value?.requestId), quantity = Number(value?.quantity);
    if (!uuid.test(requestId) || !Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('Invalid return credit');
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'return.credit', requestId);
      if (existing) return existing;
      const inspection = await db.query(`SELECT ri.id,ri.return_line_id,ri.received_quantity,rl.shipment_line_id,r.customer_id,ol.unit_price,sl.quantity AS shipment_quantity,re.tax_amount AS shipment_tax_amount,re.tax_category,re.tax_rate_bps
        FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id
        JOIN shipment_lines sl ON sl.id=rl.shipment_line_id JOIN reservations rs ON rs.id=sl.reservation_id JOIN order_lines ol ON ol.id=rs.order_line_id
        JOIN receivable_entries re ON re.shipment_line_id=sl.id
        WHERE ri.id=$1 FOR UPDATE OF ri,rl,r,sl,rs,ol`, [inspectionId]);
      if (!inspection.rowCount) throw new NotFoundException('Return inspection unavailable');
      const row = inspection.rows[0];
      if (quantity > row.received_quantity) throw new ConflictException('Credit quantity exceeds inspected quantity');
      if (row.unit_price === null) throw new ConflictException('Original shipment price unavailable');
      if ((await db.query('SELECT id FROM return_credits WHERE return_inspection_id=$1', [inspectionId])).rowCount) throw new ConflictException('Return inspection is already credited');
      const previous = (await db.query('SELECT COALESCE(sum(credited_quantity),0) AS quantity,COALESCE(sum(tax_amount),0) AS tax FROM return_credits WHERE shipment_line_id=$1',[row.shipment_line_id])).rows[0];
      const targetTax = Math.floor((Number(row.shipment_tax_amount) * (Number(previous.quantity) + quantity) + Math.floor(Number(row.shipment_quantity) / 2)) / Number(row.shipment_quantity));
      const taxAmount = targetTax - Number(previous.tax), supplyAmount = quantity * Number(row.unit_price), amount = supplyAmount + taxAmount, id = randomUUID();
      await db.query('INSERT INTO return_credits(id,return_inspection_id,return_line_id,shipment_line_id,customer_id,credited_quantity,unit_price,supply_amount,tax_amount,amount,approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, inspectionId, row.return_line_id, row.shipment_line_id, row.customer_id, quantity, row.unit_price, supplyAmount, taxAmount, amount, actorId]);
      const entryId = randomUUID();
      await db.query(`INSERT INTO receivable_entries(id,customer_id,return_credit_id,business_date,entry_type,quantity,unit_price,supply_amount,tax_amount,amount,tax_category,tax_rate_bps)
        VALUES ($1,$2,$3,CASE WHEN EXISTS(SELECT 1 FROM receivable_entries e JOIN settlement_lines sl ON sl.receivable_entry_id=e.id JOIN settlements s ON s.id=sl.settlement_id WHERE e.shipment_line_id=$4 AND s.status='finalized') THEN (date_trunc('month',CURRENT_DATE)+interval '1 month')::date ELSE CURRENT_DATE END,'return_credit',$5,$6,$7,$8,$9,$10,$11)`, [entryId, row.customer_id, id, row.shipment_line_id, quantity, row.unit_price, -supplyAmount, -taxAmount, -amount, row.tax_category, row.tax_rate_bps]);
      const response = { id, inspectionId, quantity, unitPrice: String(row.unit_price), supplyAmount: String(supplyAmount), taxAmount: String(taxAmount), amount: String(amount) };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,$2,$3,$4)', [actorId, 'return.credit', requestId, JSON.stringify(response)]);
      return response;
    });
  }
}
