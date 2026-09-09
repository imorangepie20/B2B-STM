import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';
import { pageResult, Pagination } from './pagination';
import { OrderFilters } from './order-filters';
import { notifyCustomer,notifyInternal } from '../notifications/notification-outbox';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
type OrderLineInput = { productId: string; quantity: number };
type SubmitInput = { requestId: string; warehouseId: string; lines: OrderLineInput[] };
type ShipmentInput = { requestId: string; lines: { reservationId: string; quantity: number }[] };
type WorkQuantityInput = { requestId: string; lines: { reservationId: string; quantity: number }[] };

@Injectable()
export class OrderService {
  constructor(@Inject(DATABASE) private readonly pool: Pool) {}
  private filters(filters:OrderFilters,values:unknown[],statuses:Record<string,string>){
    const clauses:string[]=[];
    if(filters.status!=='all') clauses.push(`(${statuses[filters.status]})`);
    if(filters.query){values.push(`%${filters.query}%`);const p=`$${values.length}`;clauses.push(`(o.id::text ILIKE ${p} OR c.code ILIKE ${p} OR c.name ILIKE ${p} OR w.code ILIKE ${p} OR w.name ILIKE ${p} OR EXISTS(SELECT 1 FROM order_lines search_line WHERE search_line.order_id=o.id AND (search_line.sku ILIKE ${p} OR search_line.product_name ILIKE ${p})))`)}
    if(filters.from){values.push(filters.from);clauses.push(`o.created_at >= $${values.length}::date`)}
    if(filters.to){values.push(filters.to);clauses.push(`o.created_at < $${values.length}::date + interval '1 day'`)}
    return clauses.length?` AND ${clauses.join(' AND ')}`:'';
  }

  private submitInput(body: unknown): SubmitInput {
    const value = body as { requestId?: unknown; warehouseId?: unknown; lines?: unknown } | null;
    const requestId = string(value?.requestId), warehouseId = string(value?.warehouseId);
    const lines = Array.isArray(value?.lines) ? value.lines.map(line => ({ productId: string((line as { productId?: unknown })?.productId), quantity: Number((line as { quantity?: unknown })?.quantity) })) : [];
    if (!uuid.test(requestId) || !uuid.test(warehouseId) || !lines.length || lines.some(line => !uuid.test(line.productId) || !Number.isInteger(line.quantity) || line.quantity < 1) || new Set(lines.map(line => line.productId)).size !== lines.length) {
      throw new BadRequestException('Invalid order');
    }
    return { requestId, warehouseId, lines };
  }

  private requestId(body: unknown) {
    const requestId = string((body as { requestId?: unknown } | null)?.requestId);
    if (!uuid.test(requestId)) throw new BadRequestException('Invalid request ID');
    return requestId;
  }

  private shipmentInput(body: unknown): ShipmentInput {
    const value = body as { requestId?: unknown; lines?: unknown } | null;
    const requestId = string(value?.requestId);
    const lines = Array.isArray(value?.lines) ? value.lines.map(line => ({ reservationId: string((line as { reservationId?: unknown })?.reservationId), quantity: Number((line as { quantity?: unknown })?.quantity) })) : [];
    if (!uuid.test(requestId) || !lines.length || lines.some(line => !uuid.test(line.reservationId) || !Number.isInteger(line.quantity) || line.quantity < 1) || new Set(lines.map(line => line.reservationId)).size !== lines.length) {
      throw new BadRequestException('Invalid shipment');
    }
    return { requestId, lines };
  }

  private workQuantityInput(body: unknown): WorkQuantityInput {
    const value = body as { requestId?: unknown; lines?: unknown } | null;
    const requestId = string(value?.requestId);
    const lines = Array.isArray(value?.lines) ? value.lines.map(line => ({ reservationId: string((line as { reservationId?: unknown })?.reservationId), quantity: Number((line as { quantity?: unknown })?.quantity) })) : [];
    if (!uuid.test(requestId) || !lines.length || lines.some(line => !uuid.test(line.reservationId) || !Number.isInteger(line.quantity) || line.quantity < 0) || new Set(lines.map(line => line.reservationId)).size !== lines.length) {
      throw new BadRequestException('Invalid shipment work quantities');
    }
    return { requestId, lines };
  }

  private async transaction<T>(work: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect().catch(() => { throw new ServiceUnavailableException('Order service unavailable'); });
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Order service unavailable');
    } finally { db.release(); }
  }

  private async stored(db: PoolClient, actorId: string, commandType: string, requestId: string) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actorId}:${commandType}:${requestId}`]);
    const result = await db.query('SELECT response FROM command_results WHERE actor_id=$1 AND command_type=$2 AND request_id=$3', [actorId, commandType, requestId]);
    return result.rows[0]?.response as unknown | undefined;
  }

  private async releaseOrderReservations(db: PoolClient, actorId: string, orderId: string) {
    await this.resetShipmentWork(db, actorId, orderId, '주문 취소로 피킹·검수 초기화');
    const reservations = await db.query("SELECT id,warehouse_id,product_id,quantity,shipped_quantity FROM reservations WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id=$1) AND status='active' ORDER BY product_id FOR UPDATE", [orderId]);
    let releasedQuantity = 0;
    for (const reservation of reservations.rows) {
      const quantity = reservation.quantity - reservation.shipped_quantity;
      if (!quantity) continue;
      const lockedBalance = await db.query('SELECT reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [reservation.warehouse_id, reservation.product_id]);
      if (!lockedBalance.rowCount || lockedBalance.rows[0].reserved_quantity < quantity) throw new ConflictException('Reserved inventory unavailable');
      if ((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'", [reservation.warehouse_id, reservation.product_id])).rowCount) throw new ConflictException('SKU is under stock count');
      const balance = await db.query('UPDATE inventory_balances SET reserved_quantity=reserved_quantity-$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2 AND reserved_quantity >= $3 RETURNING product_id', [reservation.warehouse_id, reservation.product_id, quantity]);
      if (!balance.rowCount) throw new ConflictException('Reserved inventory unavailable');
      await db.query("UPDATE reservations SET status='released',updated_at=now() WHERE id=$1", [reservation.id]);
      await db.query('UPDATE order_lines SET reserved_quantity=reserved_quantity-$2 WHERE id=(SELECT order_line_id FROM reservations WHERE id=$1)',[reservation.id,quantity]);
      await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by) VALUES($1,$2,'released',$3,$4)", [randomUUID(), reservation.id, quantity, actorId]);
      releasedQuantity += quantity;
    }
    const assignment = await db.query('DELETE FROM shipment_work_assignments WHERE order_id=$1 RETURNING assigned_to', [orderId]);
    if (assignment.rowCount) await db.query("INSERT INTO shipment_work_assignment_events(id,order_id,event_type,actor_id,assignee_id,reason) VALUES($1,$2,'cancelled',$3,$4,'주문 취소로 작업 종료')", [randomUUID(), orderId, actorId, assignment.rows[0].assigned_to]);
    return releasedQuantity;
  }

  private async resetShipmentWork(db: PoolClient, actorId: string, orderId: string, reason: string) {
    const work = await db.query(`SELECT swl.reservation_id,swl.picked_quantity,swl.inspected_quantity
      FROM shipment_work_lines swl JOIN reservations r ON r.id=swl.reservation_id JOIN order_lines l ON l.id=r.order_line_id
      WHERE l.order_id=$1 AND (swl.picked_quantity>0 OR swl.inspected_quantity>0) ORDER BY swl.reservation_id FOR UPDATE OF swl`, [orderId]);
    for (const line of work.rows) {
      await db.query('UPDATE shipment_work_lines SET picked_quantity=0,inspected_quantity=0,updated_by=$2,updated_at=now(),version=version+1 WHERE reservation_id=$1', [line.reservation_id, actorId]);
      await db.query("INSERT INTO shipment_work_line_events(id,reservation_id,event_type,actor_id,previous_picked_quantity,picked_quantity,previous_inspected_quantity,inspected_quantity,reason) VALUES($1,$2,'reset',$3,$4,0,$5,0,$6)", [randomUUID(), line.reservation_id, actorId, line.picked_quantity, line.inspected_quantity, reason]);
    }
  }

  async submit(customerId: string, actorId: string, body: unknown) {
    const input = this.submitInput(body);
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'order.submit', input.requestId);
      if (existing) return existing;
      if (!(await db.query('SELECT id FROM customers WHERE id=$1 AND active FOR SHARE', [customerId])).rowCount || !(await db.query('SELECT id FROM warehouses WHERE id=$1 AND active FOR SHARE', [input.warehouseId])).rowCount) {
        throw new BadRequestException('Customer or warehouse unavailable');
      }
      const products = await db.query(`SELECT p.id,p.sku,p.name,p.sale_unit,cp.unit_price,cp.tax_category,cp.tax_rate_bps FROM products p
        JOIN customer_prices cp ON cp.product_id=p.id AND cp.customer_id=$2 AND cp.active
        WHERE p.id=ANY($1::uuid[]) AND p.active FOR SHARE OF p,cp`, [input.lines.map(line => line.productId), customerId]);
      if (products.rowCount !== input.lines.length) throw new BadRequestException('Product unavailable');
      const productsById = new Map(products.rows.map(row => [row.id as string, row]));
      const id = randomUUID();
      await db.query("INSERT INTO orders(id,customer_id,warehouse_id,status,requested_by) VALUES ($1,$2,$3,'submitted',$4)", [id, customerId, input.warehouseId, actorId]);
      for (const line of input.lines) {
        const product = productsById.get(line.productId)!;
        await db.query('INSERT INTO order_lines(id,order_id,product_id,sku,product_name,sale_unit,requested_quantity,unit_price,tax_category,tax_rate_bps) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [randomUUID(), id, line.productId, product.sku, product.name, product.sale_unit, line.quantity, product.unit_price, product.tax_category, product.tax_rate_bps]);
      }
      await notifyInternal(db,['operations','system'],'order_submitted','order',id,'[STM] 신규 주문 접수',`주문번호: ${id}\n관리자 주문 관리 화면에서 확인해 주세요.`);
      const response = { id, status: 'submitted' };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,$2,$3,$4)', [actorId, 'order.submit', input.requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async catalog(customerId: string) {
    try {
      const [warehouses, products] = await Promise.all([
        this.pool.query('SELECT id,code,name FROM warehouses WHERE active ORDER BY code'),
        this.pool.query(`SELECT p.id,p.sku,p.name,p.sale_unit AS "saleUnit",cp.unit_price AS "unitPrice",b.warehouse_id AS "warehouseId",
          b.on_hand_quantity-b.reserved_quantity AS "availableQuantity"
          FROM inventory_balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id
          JOIN customer_prices cp ON cp.product_id=p.id AND cp.customer_id=$1 AND cp.active
          WHERE p.active AND w.active AND b.on_hand_quantity-b.reserved_quantity>0
            AND NOT EXISTS(SELECT 1 FROM stock_counts sc WHERE sc.warehouse_id=b.warehouse_id AND sc.product_id=b.product_id AND sc.status='counting')
          ORDER BY w.code,p.sku`, [customerId]),
      ]);
      return { warehouses: warehouses.rows, products: products.rows };
    } catch { throw new ServiceUnavailableException('Order catalog unavailable'); }
  }

  async customerOrders(customerId: string, pagination: Pagination,filters:OrderFilters={query:'',status:'all'}) {
    try {
      const values:unknown[]=[customerId];
      const incomplete=`EXISTS(SELECT 1 FROM order_lines fl LEFT JOIN reservations fr ON fr.order_line_id=fl.id WHERE fl.order_id=o.id AND COALESCE(fr.shipped_quantity,0)<fl.requested_quantity)`;
      const where=this.filters(filters,values,{active:`o.status='submitted' OR (o.status='confirmed' AND ${incomplete})`,completed:`o.status='confirmed' AND NOT ${incomplete}`,cancelled:`o.status IN ('cancelled','rejected')`});
      const [count, result] = await Promise.all([
        this.pool.query(`SELECT count(*)::int AS total FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id WHERE o.customer_id=$1${where}`, values),
        this.pool.query(`SELECT o.id,o.status,o.created_at AS "createdAt",o.confirmed_at AS "confirmedAt",
        w.code AS "warehouseCode",w.name AS "warehouseName",oc.reason AS "cancellationReason",oc.cancelled_at AS "cancelledAt",
        (SELECT json_build_object(
          'id',cr.id,'status',cr.status,'reason',cr.reason,'requestedAt',cr.requested_at,
          'reviewNote',cr.review_note,'reviewedAt',cr.reviewed_at
        ) FROM order_cancellation_requests cr WHERE cr.order_id=o.id ORDER BY cr.requested_at DESC,cr.id DESC LIMIT 1) AS "cancellationRequest",
        COALESCE((SELECT json_agg(json_build_object(
          'sku',l.sku,
          'name',l.product_name,
          'saleUnit',l.sale_unit,
          'unitPrice',l.unit_price::text,
          'requestedQuantity',l.requested_quantity,
          'reservedQuantity',l.reserved_quantity,
          'shippedQuantity',COALESCE(r.shipped_quantity,0),
          'remainingReservedQuantity',CASE WHEN r.status='active' THEN GREATEST(r.quantity-r.shipped_quantity,0) ELSE 0 END,
          'waitingQuantity',CASE WHEN o.status IN ('submitted','confirmed') THEN GREATEST(l.requested_quantity-l.reserved_quantity,0) ELSE 0 END,
          'cancelledQuantity',CASE WHEN o.status='cancelled' THEN GREATEST(l.requested_quantity-COALESCE(r.shipped_quantity,0),0) ELSE 0 END
        ) ORDER BY l.sku)
        FROM order_lines l LEFT JOIN reservations r ON r.order_line_id=l.id WHERE l.order_id=o.id),'[]') AS lines,
        COALESCE((SELECT json_agg(json_build_object(
          'id',s.id,'shippedAt',s.shipped_at,'quantity',shipment_quantity.quantity,
          'deliveryStatus',d.status,'scheduledDate',to_char(d.scheduled_date,'YYYY-MM-DD'),'carrierName',d.carrier_name,
          'trackingNumber',d.tracking_number,'dispatchedAt',d.dispatched_at,'deliveredAt',d.delivered_at,
          'recipientName',d.recipient_name,'proofMethod',d.proof_method,'proofNote',d.proof_note,
          'failureReason',d.failure_reason
        ) ORDER BY s.shipped_at,s.id)
        FROM shipments s
        JOIN (SELECT shipment_id,sum(quantity)::int AS quantity FROM shipment_lines GROUP BY shipment_id) shipment_quantity ON shipment_quantity.shipment_id=s.id
        LEFT JOIN shipment_deliveries d ON d.shipment_id=s.id
        WHERE s.order_id=o.id),'[]') AS shipments
        FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id LEFT JOIN order_cancellations oc ON oc.order_id=o.id
        WHERE o.customer_id=$1${where}
        ORDER BY o.created_at DESC,o.id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,pagination.pageSize,pagination.offset]),
      ]);
      return pageResult(result.rows, count.rows[0].total, pagination);
    } catch { throw new ServiceUnavailableException('Customer orders unavailable'); }
  }

  async shipmentQueue(actorId: string, pagination?: Pagination, query = '') {
    try {
      if (pagination) {
        const values: unknown[] = [];
        const search = query ? (() => { values.push(`%${query}%`); return ` AND (o.id::text ILIKE $1 OR c.code ILIKE $1 OR c.name ILIKE $1 OR w.code ILIKE $1 OR EXISTS (
          SELECT 1 FROM reservations sr JOIN order_lines sl ON sl.id=sr.order_line_id
          WHERE sl.order_id=o.id AND sr.status='active' AND sr.quantity>sr.shipped_quantity AND (sl.sku ILIKE $1 OR sl.product_name ILIKE $1)
        ))`; })() : '';
        const pending = `EXISTS (SELECT 1 FROM reservations pr JOIN order_lines pl ON pl.id=pr.order_line_id
          WHERE pl.order_id=o.id AND pr.status='active' AND pr.quantity>pr.shipped_quantity)
          AND NOT EXISTS (SELECT 1 FROM order_cancellation_requests cr WHERE cr.order_id=o.id AND cr.status='submitted')`;
        const [count, result] = await Promise.all([
          this.pool.query(`SELECT count(*)::int AS total FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id WHERE ${pending}${search}`, values),
          this.pool.query(`WITH page_orders AS (
            SELECT o.id,o.created_at FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id
            WHERE ${pending}${search} ORDER BY o.created_at,o.id LIMIT $${values.length + 2} OFFSET $${values.length + 3}
          )
          SELECT r.id AS "reservationId",o.id AS "orderId",o.created_at AS "orderCreatedAt",o.confirmed_at AS "confirmedAt",
          c.code AS "customerCode",c.name AS "customerName",w.code AS "warehouseCode",
          swa.assigned_to AS "assignedTo",assigned.email AS "assignedToEmail",swa.assigned_at AS "assignedAt",COALESCE(swa.assigned_to=$${values.length + 1},false) AS "assignmentMine",
          l.sku,l.product_name AS "productName",l.sale_unit AS "saleUnit",r.quantity-r.shipped_quantity AS "remainingQuantity",
          COALESCE(swl.picked_quantity,0) AS "pickedQuantity",COALESCE(swl.inspected_quantity,0) AS "inspectedQuantity",COALESCE(swl.inspected_quantity,0) AS "shippableQuantity"
          FROM page_orders po JOIN orders o ON o.id=po.id JOIN reservations r ON r.id IN (
            SELECT pr.id FROM reservations pr JOIN order_lines pl ON pl.id=pr.order_line_id WHERE pl.order_id=po.id AND pr.status='active' AND pr.quantity>pr.shipped_quantity
          ) JOIN order_lines l ON l.id=r.order_line_id JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=r.warehouse_id
          LEFT JOIN shipment_work_assignments swa ON swa.order_id=o.id LEFT JOIN users assigned ON assigned.id=swa.assigned_to
          LEFT JOIN shipment_work_lines swl ON swl.reservation_id=r.id
          ORDER BY o.created_at,o.id,l.sku`, [...values, actorId, pagination.pageSize, pagination.offset]),
        ]);
        return pageResult(result.rows, count.rows[0].total, pagination);
      }
      return (await this.pool.query(`SELECT r.id AS "reservationId",o.id AS "orderId",o.created_at AS "orderCreatedAt",o.confirmed_at AS "confirmedAt",
        c.code AS "customerCode",c.name AS "customerName",w.code AS "warehouseCode",
        swa.assigned_to AS "assignedTo",assigned.email AS "assignedToEmail",swa.assigned_at AS "assignedAt",COALESCE(swa.assigned_to=$1,false) AS "assignmentMine",
        l.sku,l.product_name AS "productName",l.sale_unit AS "saleUnit",r.quantity-r.shipped_quantity AS "remainingQuantity",
        COALESCE(swl.picked_quantity,0) AS "pickedQuantity",COALESCE(swl.inspected_quantity,0) AS "inspectedQuantity",COALESCE(swl.inspected_quantity,0) AS "shippableQuantity"
        FROM reservations r JOIN order_lines l ON l.id=r.order_line_id JOIN orders o ON o.id=l.order_id
        JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=r.warehouse_id
        LEFT JOIN shipment_work_assignments swa ON swa.order_id=o.id LEFT JOIN users assigned ON assigned.id=swa.assigned_to
        LEFT JOIN shipment_work_lines swl ON swl.reservation_id=r.id
        WHERE r.status='active' AND r.quantity>r.shipped_quantity
          AND NOT EXISTS (SELECT 1 FROM order_cancellation_requests cr WHERE cr.order_id=o.id AND cr.status='submitted')
        ORDER BY o.created_at,o.id,l.sku`, [actorId])).rows;
    } catch { throw new ServiceUnavailableException('Shipment queue unavailable'); }
  }

  async claimShipmentWork(actorId: string, orderId: string, body: unknown) {
    if (!uuid.test(orderId)) throw new BadRequestException('Invalid order ID');
    const requestId = this.requestId(body);
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'shipment.work.claim', requestId);
      if (existing) return existing;
      const order = await db.query("SELECT id FROM orders WHERE id=$1 AND status='confirmed' FOR UPDATE", [orderId]);
      if (!order.rowCount) throw new ConflictException('Order is unavailable for shipment work');
      const pending = await db.query("SELECT 1 FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=$1 AND r.status='active' AND r.quantity>r.shipped_quantity LIMIT 1", [orderId]);
      if (!pending.rowCount || (await db.query("SELECT 1 FROM order_cancellation_requests WHERE order_id=$1 AND status='submitted'", [orderId])).rowCount) throw new ConflictException('Order is unavailable for shipment work');
      if ((await db.query("SELECT 1 FROM reservations r JOIN order_lines l ON l.id=r.order_line_id JOIN stock_counts sc ON sc.warehouse_id=r.warehouse_id AND sc.product_id=r.product_id AND sc.status='counting' WHERE l.order_id=$1 AND r.status='active' LIMIT 1",[orderId])).rowCount) throw new ConflictException('Order contains SKU under stock count');
      const assignment = await db.query('SELECT assigned_to FROM shipment_work_assignments WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (assignment.rowCount && assignment.rows[0].assigned_to !== actorId) throw new ConflictException('Shipment work is assigned to another worker');
      if (!assignment.rowCount) {
        await db.query('INSERT INTO shipment_work_assignments(order_id,assigned_to) VALUES($1,$2)', [orderId, actorId]);
        await db.query("INSERT INTO shipment_work_assignment_events(id,order_id,event_type,actor_id,assignee_id) VALUES($1,$2,'claimed',$3,$3)", [randomUUID(), orderId, actorId]);
      }
      const response = { orderId, assignedTo: actorId, status: 'assigned' };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, 'shipment.work.claim', requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async releaseShipmentWork(actorId: string, orderId: string, body: unknown) {
    if (!uuid.test(orderId)) throw new BadRequestException('Invalid order ID');
    const requestId = this.requestId(body);
    const reason = string((body as { reason?: unknown } | null)?.reason);
    if (!reason || reason.length > 300) throw new BadRequestException('Release reason is required');
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'shipment.work.release', requestId);
      if (existing) return existing;
      const assignment = await db.query('SELECT assigned_to FROM shipment_work_assignments WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (!assignment.rowCount) throw new ConflictException('Shipment work is not assigned');
      if (assignment.rows[0].assigned_to !== actorId) throw new ConflictException('Only the assigned worker can release shipment work');
      await db.query('DELETE FROM shipment_work_assignments WHERE order_id=$1', [orderId]);
      await db.query("INSERT INTO shipment_work_assignment_events(id,order_id,event_type,actor_id,assignee_id,reason) VALUES($1,$2,'released',$3,$3,$4)", [randomUUID(), orderId, actorId, reason]);
      const response = { orderId, releasedBy: actorId, status: 'released' };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, 'shipment.work.release', requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async setPickedQuantities(actorId: string, orderId: string, body: unknown) {
    return this.setShipmentWorkQuantities(actorId, orderId, body, 'picked');
  }

  async setInspectedQuantities(actorId: string, orderId: string, body: unknown) {
    return this.setShipmentWorkQuantities(actorId, orderId, body, 'inspected');
  }

  private async setShipmentWorkQuantities(actorId: string, orderId: string, body: unknown, stage: 'picked' | 'inspected') {
    if (!uuid.test(orderId)) throw new BadRequestException('Invalid order ID');
    const input = this.workQuantityInput(body), commandType = `shipment.work.${stage}`;
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, commandType, input.requestId);
      if (existing) return existing;
      if (!(await db.query("SELECT id FROM orders WHERE id=$1 AND status='confirmed' FOR UPDATE", [orderId])).rowCount) throw new ConflictException('Order is unavailable for shipment work');
      const assignment = await db.query('SELECT assigned_to FROM shipment_work_assignments WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (!assignment.rowCount || assignment.rows[0].assigned_to !== actorId) throw new ConflictException('Only the assigned worker can update shipment work');
      if ((await db.query("SELECT 1 FROM order_cancellation_requests WHERE order_id=$1 AND status='submitted'", [orderId])).rowCount) throw new ConflictException('Order cancellation review is pending');
      const responseLines: { reservationId: string; pickedQuantity: number; inspectedQuantity: number }[] = [];
      for (const line of [...input.lines].sort((a, b) => a.reservationId.localeCompare(b.reservationId))) {
        const reservation = await db.query(`SELECT r.id,r.warehouse_id,r.product_id,r.quantity-r.shipped_quantity AS remaining_quantity
          FROM reservations r JOIN order_lines l ON l.id=r.order_line_id
          WHERE r.id=$1 AND l.order_id=$2 AND r.status='active' FOR UPDATE OF r`, [line.reservationId, orderId]);
        if (!reservation.rowCount) throw new ConflictException('Reservation unavailable for shipment work');
        await db.query('SELECT product_id FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE',[reservation.rows[0].warehouse_id,reservation.rows[0].product_id]);
        if((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[reservation.rows[0].warehouse_id,reservation.rows[0].product_id])).rowCount)throw new ConflictException('SKU is under stock count');
        const current = await db.query('SELECT picked_quantity,inspected_quantity FROM shipment_work_lines WHERE reservation_id=$1 FOR UPDATE', [line.reservationId]);
        const previousPicked = Number(current.rows[0]?.picked_quantity ?? 0), previousInspected = Number(current.rows[0]?.inspected_quantity ?? 0);
        const pickedQuantity = stage === 'picked' ? line.quantity : previousPicked;
        const inspectedQuantity = stage === 'inspected' ? line.quantity : previousInspected;
        if (pickedQuantity > Number(reservation.rows[0].remaining_quantity)) throw new ConflictException('Picked quantity exceeds reservation');
        if (inspectedQuantity > pickedQuantity) throw new ConflictException('Inspected quantity exceeds picked quantity');
        await db.query(`INSERT INTO shipment_work_lines(reservation_id,picked_quantity,inspected_quantity,updated_by,picked_at,inspected_at)
          VALUES($1,$2,$3,$4,CASE WHEN $5='picked' THEN now() END,CASE WHEN $5='inspected' THEN now() END)
          ON CONFLICT(reservation_id) DO UPDATE SET picked_quantity=EXCLUDED.picked_quantity,inspected_quantity=EXCLUDED.inspected_quantity,updated_by=EXCLUDED.updated_by,
          picked_at=CASE WHEN $5='picked' THEN now() ELSE shipment_work_lines.picked_at END,
          inspected_at=CASE WHEN $5='inspected' THEN now() ELSE shipment_work_lines.inspected_at END,updated_at=now(),version=shipment_work_lines.version+1`,
          [line.reservationId, pickedQuantity, inspectedQuantity, actorId, stage]);
        await db.query(`INSERT INTO shipment_work_line_events(id,reservation_id,event_type,actor_id,previous_picked_quantity,picked_quantity,previous_inspected_quantity,inspected_quantity)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), line.reservationId, stage, actorId, previousPicked, pickedQuantity, previousInspected, inspectedQuantity]);
        responseLines.push({ reservationId: line.reservationId, pickedQuantity, inspectedQuantity });
      }
      const response = { orderId, stage, lines: responseLines };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, commandType, input.requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async adminOrderHistory(pagination: Pagination,filters:OrderFilters={query:'',status:'all'}) {
    try {
      const values:unknown[]=[];
      const incomplete=`EXISTS(SELECT 1 FROM order_lines fl LEFT JOIN reservations fr ON fr.order_line_id=fl.id WHERE fl.order_id=o.id AND COALESCE(fr.shipped_quantity,0)<fl.requested_quantity)`;
      const where=this.filters(filters,values,{submitted:`o.status='submitted'`,in_progress:`o.status='confirmed' AND ${incomplete}`,completed:`o.status='confirmed' AND NOT ${incomplete}`,cancelled:`o.status IN ('cancelled','rejected')`});
      const [count, result] = await Promise.all([
        this.pool.query(`SELECT count(*)::int AS total FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id WHERE TRUE${where}`,values),
        this.pool.query(`SELECT o.id,o.status,o.created_at AS "createdAt",o.confirmed_at AS "confirmedAt",o.updated_at AS "updatedAt",
        c.code AS "customerCode",c.name AS "customerName",w.code AS "warehouseCode",w.name AS "warehouseName",
        CASE
          WHEN o.status='cancelled' THEN 'cancelled'
          WHEN o.status='rejected' THEN 'rejected'
          WHEN o.status='submitted' THEN 'submitted'
          WHEN NOT EXISTS (
            SELECT 1 FROM order_lines completion_line LEFT JOIN reservations completion_reservation ON completion_reservation.order_line_id=completion_line.id
            WHERE completion_line.order_id=o.id AND COALESCE(completion_reservation.shipped_quantity,0)<completion_line.requested_quantity
          ) THEN 'completed'
          ELSE 'in_progress'
        END AS "fulfillmentStatus",
        oc.reason AS "cancellationReason",oc.cancelled_at AS "cancelledAt",cancelled_user.email AS "cancelledBy",
        COALESCE((SELECT json_agg(json_build_object(
          'id',cr.id,'status',cr.status,'reason',cr.reason,'requestedAt',cr.requested_at,
          'requestedBy',request_user.email,'reviewNote',cr.review_note,'reviewedAt',cr.reviewed_at,
          'reviewedBy',review_user.email
        ) ORDER BY cr.requested_at,cr.id)
        FROM order_cancellation_requests cr JOIN users request_user ON request_user.id=cr.requested_by
        LEFT JOIN users review_user ON review_user.id=cr.reviewed_by WHERE cr.order_id=o.id),'[]') AS "cancellationRequests",
        COALESCE((SELECT json_agg(json_build_object(
          'sku',l.sku,
          'name',l.product_name,
          'saleUnit',l.sale_unit,
          'unitPrice',l.unit_price::text,
          'requestedQuantity',l.requested_quantity,
          'shippedQuantity',COALESCE(r.shipped_quantity,0),
          'remainingReservedQuantity',CASE WHEN r.status='active' THEN GREATEST(r.quantity-r.shipped_quantity,0) ELSE 0 END,
          'waitingQuantity',CASE WHEN o.status IN ('submitted','confirmed') THEN GREATEST(l.requested_quantity-l.reserved_quantity,0) ELSE 0 END,
          'cancelledQuantity',CASE WHEN o.status='cancelled' THEN GREATEST(l.requested_quantity-COALESCE(r.shipped_quantity,0),0) ELSE 0 END
        ) ORDER BY l.sku) FROM order_lines l LEFT JOIN reservations r ON r.order_line_id=l.id WHERE l.order_id=o.id),'[]') AS lines,
        COALESCE((SELECT json_agg(json_build_object(
          'id',shipment_row.id,
          'shippedAt',shipment_row.shipped_at,
          'shippedBy',shipment_row.shipped_by,
          'quantity',shipment_row.quantity,
          'amount',shipment_row.amount,
          'deliveryStatus',shipment_row.delivery_status,
          'scheduledDate',to_char(shipment_row.scheduled_date,'YYYY-MM-DD'),
          'carrierName',shipment_row.carrier_name,
          'trackingNumber',shipment_row.tracking_number,
          'dispatchedAt',shipment_row.dispatched_at,
          'deliveredAt',shipment_row.delivered_at,
          'recipientName',shipment_row.recipient_name,
          'proofMethod',shipment_row.proof_method,
          'proofNote',shipment_row.proof_note,
          'failureReason',shipment_row.failure_reason,
          'lines',shipment_row.lines
        ) ORDER BY shipment_row.shipped_at,shipment_row.id)
        FROM (
          SELECT s.id,s.shipped_at,u.email AS shipped_by,d.status AS delivery_status,d.scheduled_date,
            d.carrier_name,d.tracking_number,d.dispatched_at,d.delivered_at,d.recipient_name,d.proof_method,d.proof_note,d.failure_reason,
            sum(sl.quantity)::int AS quantity,COALESCE(sum(re.amount),0)::text AS amount,
            json_agg(json_build_object(
              'shipmentLineId',sl.id,
              'ledgerId',re.id,
              'sku',l.sku,
              'name',l.product_name,
              'saleUnit',l.sale_unit,
              'quantity',sl.quantity,
              'unitPrice',re.unit_price::text,
              'amount',re.amount::text
            ) ORDER BY l.sku) AS lines
          FROM shipments s JOIN users u ON u.id=s.shipped_by JOIN shipment_lines sl ON sl.shipment_id=s.id
          JOIN reservations r ON r.id=sl.reservation_id JOIN order_lines l ON l.id=r.order_line_id
          LEFT JOIN receivable_entries re ON re.shipment_line_id=sl.id
          LEFT JOIN shipment_deliveries d ON d.shipment_id=s.id
          WHERE s.order_id=o.id
          GROUP BY s.id,s.shipped_at,u.email,d.status,d.scheduled_date,d.carrier_name,d.tracking_number,d.dispatched_at,d.delivered_at,
            d.recipient_name,d.proof_method,d.proof_note,d.failure_reason
        ) shipment_row),'[]') AS shipments
        FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id
        LEFT JOIN order_cancellations oc ON oc.order_id=o.id LEFT JOIN users cancelled_user ON cancelled_user.id=oc.cancelled_by
        WHERE TRUE${where}
        ORDER BY o.created_at DESC,o.id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,pagination.pageSize,pagination.offset]),
      ]);
      return pageResult(result.rows, count.rows[0].total, pagination);
    } catch { throw new ServiceUnavailableException('Order history unavailable'); }
  }

  async ship(actorId: string, body: unknown) {
    const input = this.shipmentInput(body);
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'shipment.create', input.requestId);
      if (existing) return existing;
      const reservationIds = [...input.lines.map(line => line.reservationId)].sort();
      const reservations = new Map<string, any>();
      for (const reservationId of reservationIds) {
        const result = await db.query(`SELECT r.id,r.warehouse_id,r.product_id,r.quantity,r.shipped_quantity,l.id AS order_line_id,l.order_id,l.unit_price,l.tax_category,l.tax_rate_bps,o.customer_id
          FROM reservations r JOIN order_lines l ON l.id=r.order_line_id JOIN orders o ON o.id=l.order_id WHERE r.id=$1 AND r.status='active' FOR UPDATE OF r,l,o`, [reservationId]);
        if (!result.rowCount) throw new ConflictException('Reservation unavailable');
        reservations.set(reservationId, result.rows[0]);
      }
      const orderId = reservations.values().next().value.order_id, warehouseId = reservations.values().next().value.warehouse_id;
      if ([...reservations.values()].some(row => row.order_id !== orderId || row.warehouse_id !== warehouseId)) throw new BadRequestException('Shipment lines must belong to one order and warehouse');
      const assignment = await db.query('SELECT assigned_to FROM shipment_work_assignments WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (assignment.rowCount && assignment.rows[0].assigned_to !== actorId) throw new ConflictException('Shipment work is assigned to another worker');
      if (!assignment.rowCount) {
        await db.query('INSERT INTO shipment_work_assignments(order_id,assigned_to) VALUES($1,$2)', [orderId, actorId]);
        await db.query("INSERT INTO shipment_work_assignment_events(id,order_id,event_type,actor_id,assignee_id) VALUES($1,$2,'claimed',$3,$3)", [randomUUID(), orderId, actorId]);
      }
      if ((await db.query("SELECT id FROM order_cancellation_requests WHERE order_id=$1 AND status='submitted'", [orderId])).rowCount) throw new ConflictException('Order cancellation review is pending');
      const shipmentId = randomUUID();
      await db.query("INSERT INTO shipments(id,order_id,warehouse_id,status,shipped_by) VALUES ($1,$2,$3,'shipped',$4)", [shipmentId, orderId, warehouseId, actorId]);
      await db.query("INSERT INTO shipment_deliveries(shipment_id,status,updated_by) VALUES($1,'ready',$2)",[shipmentId,actorId]);
      await db.query("INSERT INTO shipment_delivery_events(id,shipment_id,event_type,actor_id,to_status) VALUES($1,$2,'created',$3,'ready')",[randomUUID(),shipmentId,actorId]);
      let shippedQuantity = 0;
      for (const line of input.lines) {
        const reservation = reservations.get(line.reservationId)!;
        if (line.quantity > reservation.quantity - reservation.shipped_quantity) throw new ConflictException('Shipment quantity exceeds reservation');
        const work = await db.query('SELECT picked_quantity,inspected_quantity FROM shipment_work_lines WHERE reservation_id=$1 FOR UPDATE', [reservation.id]);
        if (!work.rowCount || line.quantity > work.rows[0].inspected_quantity) throw new ConflictException('Shipment quantity exceeds inspected quantity');
        const balance = await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [reservation.warehouse_id, reservation.product_id]);
        if((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[reservation.warehouse_id,reservation.product_id])).rowCount)throw new ConflictException('SKU is under stock count');
        if (!balance.rowCount || balance.rows[0].on_hand_quantity < line.quantity || balance.rows[0].reserved_quantity < line.quantity) throw new ConflictException('Reserved inventory unavailable');
        const lineId = randomUUID();
        await db.query('INSERT INTO shipment_lines(id,shipment_id,reservation_id,quantity) VALUES ($1,$2,$3,$4)', [lineId, shipmentId, reservation.id, line.quantity]);
        await db.query('UPDATE inventory_balances SET on_hand_quantity=on_hand_quantity-$3,reserved_quantity=reserved_quantity-$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2', [reservation.warehouse_id, reservation.product_id, line.quantity]);
        await db.query("UPDATE reservations SET shipped_quantity=shipped_quantity+$2,status=CASE WHEN shipped_quantity+$2=quantity THEN 'shipped' ELSE 'active' END,updated_at=now() WHERE id=$1", [reservation.id, line.quantity]);
        await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by) VALUES ($1,$2,'shipped',$3,$4)", [randomUUID(), reservation.id, line.quantity, actorId]);
        await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,shipment_line_id,created_by) VALUES ($1,$2,$3,'shipment',$4,$5,$6)", [randomUUID(), reservation.warehouse_id, reservation.product_id, -line.quantity, lineId, actorId]);
        if (reservation.unit_price === null) throw new ConflictException('Order price unavailable');
        const supplyAmount = line.quantity * Number(reservation.unit_price);
        const previous = (await db.query(`SELECT COALESCE(sum(e.supply_amount),0) AS supply,COALESCE(sum(e.tax_amount),0) AS tax
          FROM receivable_entries e JOIN shipment_lines sl ON sl.id=e.shipment_line_id JOIN reservations r ON r.id=sl.reservation_id
          WHERE r.order_line_id=$1`, [reservation.order_line_id])).rows[0];
        const cumulativeSupply = Number(previous.supply) + supplyAmount;
        const targetTax = reservation.tax_category === 'taxable' ? Math.floor((cumulativeSupply * Number(reservation.tax_rate_bps) + 5000) / 10000) : 0;
        const taxAmount = targetTax - Number(previous.tax);
        await db.query("INSERT INTO receivable_entries(id,customer_id,shipment_line_id,business_date,entry_type,quantity,unit_price,supply_amount,tax_amount,amount,tax_category,tax_rate_bps) VALUES ($1,$2,$3,CURRENT_DATE,'shipment',$4,$5,$6,$7,$8,$9,$10)", [randomUUID(), reservation.customer_id, lineId, line.quantity, reservation.unit_price, supplyAmount, taxAmount, supplyAmount + taxAmount, reservation.tax_category, reservation.tax_rate_bps]);
        const nextPicked = work.rows[0].picked_quantity - line.quantity, nextInspected = work.rows[0].inspected_quantity - line.quantity;
        await db.query('UPDATE shipment_work_lines SET picked_quantity=$2,inspected_quantity=$3,updated_by=$4,updated_at=now(),version=version+1 WHERE reservation_id=$1', [reservation.id, nextPicked, nextInspected, actorId]);
        await db.query(`INSERT INTO shipment_work_line_events(id,reservation_id,event_type,actor_id,previous_picked_quantity,picked_quantity,previous_inspected_quantity,inspected_quantity)
          VALUES($1,$2,'shipped',$3,$4,$5,$6,$7)`, [randomUUID(), reservation.id, actorId, work.rows[0].picked_quantity, nextPicked, work.rows[0].inspected_quantity, nextInspected]);
        shippedQuantity += line.quantity;
      }
      const remaining = await db.query("SELECT 1 FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=$1 AND r.status='active' AND r.quantity>r.shipped_quantity LIMIT 1", [orderId]);
      if (!remaining.rowCount) {
        await db.query('DELETE FROM shipment_work_assignments WHERE order_id=$1', [orderId]);
        await db.query("INSERT INTO shipment_work_assignment_events(id,order_id,event_type,actor_id,assignee_id) VALUES($1,$2,'completed',$3,$3)", [randomUUID(), orderId, actorId]);
      }
      const customerId=reservations.get(input.lines[0].reservationId)!.customer_id;
      await notifyCustomer(db,customerId,'shipment_created','shipment',shipmentId,'[STM] 주문 출고 완료',`출고번호: ${shipmentId}\n출고수량: ${shippedQuantity}\n거래처 포털에서 배송 상태를 확인해 주세요.`);
      const response = { id: shipmentId, status: 'shipped', shippedQuantity };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,$2,$3,$4)', [actorId, 'shipment.create', input.requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async confirm(actorId: string, orderId: string, body: unknown) {
    if (!uuid.test(orderId)) throw new BadRequestException('Invalid order ID');
    const requestId = this.requestId(body);
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'order.confirm', requestId);
      if (existing) return existing;
      const order = await db.query("SELECT id,warehouse_id FROM orders WHERE id=$1 AND status='submitted' FOR UPDATE", [orderId]);
      if (!order.rowCount) {
        const exists = await db.query('SELECT id FROM orders WHERE id=$1', [orderId]);
        if (!exists.rowCount) throw new NotFoundException('Order unavailable');
        throw new ConflictException('Order is already processed');
      }
      const lines = await db.query('SELECT id,product_id,requested_quantity FROM order_lines WHERE order_id=$1 ORDER BY product_id FOR UPDATE', [orderId]);
      let reservedQuantity = 0, unreservedQuantity = 0;
      for (const line of lines.rows) {
        const balance = await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [order.rows[0].warehouse_id, line.product_id]);
        if((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[order.rows[0].warehouse_id,line.product_id])).rowCount)throw new ConflictException('SKU is under stock count');
        const available = balance.rowCount ? Math.max(0, balance.rows[0].on_hand_quantity - balance.rows[0].reserved_quantity) : 0;
        const quantity = Math.min(line.requested_quantity, available);
        reservedQuantity += quantity;
        unreservedQuantity += line.requested_quantity - quantity;
        if (!quantity) continue;
        await db.query('UPDATE inventory_balances SET reserved_quantity=reserved_quantity+$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2', [order.rows[0].warehouse_id, line.product_id, quantity]);
        await db.query('UPDATE order_lines SET reserved_quantity=$2 WHERE id=$1', [line.id, quantity]);
        const reservationId = randomUUID();
        await db.query("INSERT INTO reservations(id,order_line_id,warehouse_id,product_id,quantity,status,created_by) VALUES ($1,$2,$3,$4,$5,'active',$6)", [reservationId, line.id, order.rows[0].warehouse_id, line.product_id, quantity, actorId]);
        await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by) VALUES ($1,$2,'created',$3,$4)", [randomUUID(), reservationId, quantity, actorId]);
      }
      await db.query("UPDATE orders SET status='confirmed',confirmed_by=$2,confirmed_at=now(),updated_at=now(),version=version+1 WHERE id=$1", [orderId, actorId]);
      const response = { id: orderId, status: 'confirmed', reservedQuantity, unreservedQuantity };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES ($1,$2,$3,$4)', [actorId, 'order.confirm', requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async allocate(actorId: string, orderId: string, body: unknown) {
    if (!uuid.test(orderId)) throw new BadRequestException('Invalid order ID');
    const requestId = this.requestId(body);
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'order.allocate', requestId);
      if (existing) return existing;
      const order = await db.query("SELECT id,warehouse_id FROM orders WHERE id=$1 AND status='confirmed' FOR UPDATE", [orderId]);
      if (!order.rowCount) {
        const exists = await db.query('SELECT id FROM orders WHERE id=$1', [orderId]);
        if (!exists.rowCount) throw new NotFoundException('Order unavailable');
        throw new ConflictException('Order cannot receive inventory allocation');
      }
      if ((await db.query("SELECT id FROM order_cancellation_requests WHERE order_id=$1 AND status='submitted'", [orderId])).rowCount) throw new ConflictException('Order cancellation review is pending');
      if((await db.query("SELECT 1 FROM order_lines l JOIN stock_counts sc ON sc.warehouse_id=$2 AND sc.product_id=l.product_id AND sc.status='counting' WHERE l.order_id=$1 LIMIT 1",[orderId,order.rows[0].warehouse_id])).rowCount)throw new ConflictException('Order contains SKU under stock count');
      const lines = await db.query('SELECT id,product_id,requested_quantity,reserved_quantity FROM order_lines WHERE order_id=$1 ORDER BY product_id FOR UPDATE', [orderId]);
      let allocatedQuantity = 0;
      let unallocatedQuantity = 0;
      for (const line of lines.rows) {
        const waitingQuantity = line.requested_quantity - line.reserved_quantity;
        if (waitingQuantity <= 0) continue;
        const balance = await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [order.rows[0].warehouse_id, line.product_id]);
        if((await db.query("SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[order.rows[0].warehouse_id,line.product_id])).rowCount)throw new ConflictException('SKU is under stock count');
        const availableQuantity = balance.rowCount ? Math.max(0, balance.rows[0].on_hand_quantity - balance.rows[0].reserved_quantity) : 0;
        const quantity = Math.min(waitingQuantity, availableQuantity);
        unallocatedQuantity += waitingQuantity - quantity;
        if (!quantity) continue;
        await db.query('UPDATE inventory_balances SET reserved_quantity=reserved_quantity+$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2', [order.rows[0].warehouse_id, line.product_id, quantity]);
        await db.query('UPDATE order_lines SET reserved_quantity=reserved_quantity+$2 WHERE id=$1', [line.id, quantity]);
        const reservation = await db.query('SELECT id FROM reservations WHERE order_line_id=$1 FOR UPDATE', [line.id]);
        let reservationId: string;
        if (reservation.rowCount) {
          reservationId = reservation.rows[0].id;
          await db.query("UPDATE reservations SET quantity=CASE WHEN status='released' THEN shipped_quantity+$2 ELSE quantity+$2 END,status='active',updated_at=now() WHERE id=$1", [reservationId, quantity]);
        } else {
          reservationId = randomUUID();
          await db.query("INSERT INTO reservations(id,order_line_id,warehouse_id,product_id,quantity,status,created_by) VALUES ($1,$2,$3,$4,$5,'active',$6)", [reservationId, line.id, order.rows[0].warehouse_id, line.product_id, quantity, actorId]);
        }
        await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by) VALUES ($1,$2,'created',$3,$4)", [randomUUID(), reservationId, quantity, actorId]);
        allocatedQuantity += quantity;
      }
      const response = { id: orderId, status: 'confirmed', allocatedQuantity, unallocatedQuantity };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, 'order.allocate', requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async cancel(actorId: string, orderId: string, body: unknown) {
    if (!uuid.test(orderId)) throw new BadRequestException('Invalid order ID');
    const requestId = this.requestId(body), reason = string((body as { reason?: unknown } | null)?.reason);
    if (!reason) throw new BadRequestException('Cancellation reason is required');
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'order.cancel', requestId);
      if (existing) return existing;
      const order = await db.query("SELECT id,warehouse_id FROM orders WHERE id=$1 AND status='confirmed' FOR UPDATE", [orderId]);
      if (!order.rowCount) {
        const exists = await db.query('SELECT id FROM orders WHERE id=$1', [orderId]);
        if (!exists.rowCount) throw new NotFoundException('Order unavailable');
        throw new ConflictException('Order cannot be cancelled');
      }
      if ((await db.query("SELECT id FROM order_cancellation_requests WHERE order_id=$1 AND status='submitted'", [orderId])).rowCount) throw new ConflictException('Order cancellation review is pending');
      const releasedQuantity = await this.releaseOrderReservations(db, actorId, orderId);
      const cancellation = await db.query('INSERT INTO order_cancellations(order_id,reason,cancelled_by) VALUES ($1,$2,$3) RETURNING cancelled_at', [orderId, reason, actorId]);
      await db.query("UPDATE orders SET status='cancelled',updated_at=now(),version=version+1 WHERE id=$1", [orderId]);
      const response = { id: orderId, status: 'cancelled', releasedQuantity, reason, cancelledAt: cancellation.rows[0].cancelled_at };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, 'order.cancel', requestId, JSON.stringify(response)]);
      return response;
    });
  }

  async requestCancellation(customerId: string, actorId: string, orderId: string, body: unknown) {
    if (!uuid.test(orderId)) throw new BadRequestException('Invalid order ID');
    const commandRequestId = this.requestId(body), reason = string((body as { reason?: unknown } | null)?.reason);
    if (!reason) throw new BadRequestException('Cancellation reason is required');
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, 'order.cancellation.request', commandRequestId);
      if (existing) return existing;
      const order = await db.query('SELECT id,status FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [orderId, customerId]);
      if (!order.rowCount) throw new NotFoundException('Order unavailable');
      if (order.rows[0].status !== 'confirmed') throw new ConflictException('Order cannot be requested for cancellation');
      const unshipped = await db.query(`SELECT COALESCE(sum(l.requested_quantity-COALESCE(r.shipped_quantity,0)),0)::int AS quantity
        FROM order_lines l LEFT JOIN reservations r ON r.order_line_id=l.id WHERE l.order_id=$1`, [orderId]);
      if (unshipped.rows[0].quantity < 1) throw new ConflictException('Order has no unshipped quantity');
      if ((await db.query("SELECT id FROM order_cancellation_requests WHERE order_id=$1 AND status='submitted'", [orderId])).rowCount) throw new ConflictException('Cancellation request already submitted');
      const id = randomUUID();
      const inserted = await db.query("INSERT INTO order_cancellation_requests(id,order_id,reason,status,requested_by) VALUES($1,$2,$3,'submitted',$4) RETURNING requested_at", [id, orderId, reason, actorId]);
      const assignment = await db.query('DELETE FROM shipment_work_assignments WHERE order_id=$1 RETURNING assigned_to', [orderId]);
      await this.resetShipmentWork(db, actorId, orderId, '취소 검토 요청으로 피킹·검수 초기화');
      if (assignment.rowCount) await db.query("INSERT INTO shipment_work_assignment_events(id,order_id,event_type,actor_id,assignee_id,reason) VALUES($1,$2,'released',$3,$4,'취소 검토 요청으로 작업 자동 반납')", [randomUUID(), orderId, actorId, assignment.rows[0].assigned_to]);
      const response = { id, orderId, status: 'submitted', reason, requestedAt: inserted.rows[0].requested_at };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, 'order.cancellation.request', commandRequestId, JSON.stringify(response)]);
      return response;
    });
  }

  async reviewCancellation(actorId: string, requestRecordId: string, decision: 'approved' | 'rejected', body: unknown) {
    if (!uuid.test(requestRecordId)) throw new BadRequestException('Invalid cancellation request ID');
    const commandRequestId = this.requestId(body), reviewNote = string((body as { reviewNote?: unknown } | null)?.reviewNote);
    if (decision === 'rejected' && !reviewNote) throw new BadRequestException('Review note is required');
    const commandType = `order.cancellation.${decision}`;
    return this.transaction(async db => {
      const existing = await this.stored(db, actorId, commandType, commandRequestId);
      if (existing) return existing;
      const requestReference = await db.query('SELECT order_id FROM order_cancellation_requests WHERE id=$1', [requestRecordId]);
      if (!requestReference.rowCount) throw new NotFoundException('Cancellation request unavailable');
      const orderId = requestReference.rows[0].order_id as string;
      const order = await db.query('SELECT id,status FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const request = await db.query("SELECT id,reason,status FROM order_cancellation_requests WHERE id=$1 AND order_id=$2 FOR UPDATE", [requestRecordId, orderId]);
      if (!request.rowCount || request.rows[0].status !== 'submitted') throw new ConflictException('Cancellation request is already reviewed');
      if (!order.rowCount || order.rows[0].status !== 'confirmed') throw new ConflictException('Order cannot be reviewed for cancellation');

      if (decision === 'rejected') {
        await db.query("UPDATE order_cancellation_requests SET status='rejected',reviewed_by=$2,reviewed_at=now(),review_note=$3,updated_at=now() WHERE id=$1", [requestRecordId, actorId, reviewNote]);
        const response = { id: requestRecordId, orderId, status: 'rejected', reviewNote };
        await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, commandType, commandRequestId, JSON.stringify(response)]);
        return response;
      }

      const releasedQuantity = await this.releaseOrderReservations(db, actorId, orderId);
      const cancellation = await db.query('INSERT INTO order_cancellations(order_id,reason,cancelled_by) VALUES ($1,$2,$3) RETURNING cancelled_at', [orderId, request.rows[0].reason, actorId]);
      await db.query("UPDATE orders SET status='cancelled',updated_at=now(),version=version+1 WHERE id=$1", [orderId]);
      await db.query("UPDATE order_cancellation_requests SET status='approved',reviewed_by=$2,reviewed_at=now(),updated_at=now() WHERE id=$1", [requestRecordId, actorId]);
      const response = { id: requestRecordId, orderId, status: 'approved', releasedQuantity, reviewedBy: actorId, cancelledAt: cancellation.rows[0].cancelled_at };
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)', [actorId, commandType, commandRequestId, JSON.stringify(response)]);
      return response;
    });
  }

  async deliveries() {
    try{return (await this.pool.query(`SELECT s.id AS "shipmentId",s.shipped_at AS "shippedAt",o.id AS "orderId",c.code AS "customerCode",c.name AS "customerName",w.code AS "warehouseCode",
      d.status,to_char(d.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",d.carrier_name AS "carrierName",d.tracking_number AS "trackingNumber",d.dispatched_at AS "dispatchedAt",d.delivered_at AS "deliveredAt",d.recipient_name AS "recipientName",d.proof_method AS "proofMethod",d.proof_note AS "proofNote",d.failure_reason AS "failureReason",
      (SELECT sum(sl.quantity)::int FROM shipment_lines sl WHERE sl.shipment_id=s.id) AS quantity
      FROM shipments s JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=s.warehouse_id JOIN shipment_deliveries d ON d.shipment_id=s.id ORDER BY s.shipped_at DESC,s.id DESC`)).rows}catch{throw new ServiceUnavailableException('Deliveries unavailable')}
  }

  async updateDelivery(actorId:string,shipmentId:string,action:'schedule'|'dispatch'|'deliver'|'fail',body:unknown){
    if(!uuid.test(shipmentId))throw new BadRequestException('Invalid shipment ID'); const value=body as any,requestId=this.requestId(body);
    return this.transaction(async db=>{const type=`delivery.${action}`,existing=await this.stored(db,actorId,type,requestId);if(existing)return existing;
      const result=await db.query('SELECT * FROM shipment_deliveries WHERE shipment_id=$1 FOR UPDATE',[shipmentId]);if(!result.rowCount)throw new NotFoundException('Delivery unavailable');const current=result.rows[0];let next:string,event:string,detail:any={};
      if(action==='schedule'){const date=string(value?.scheduledDate),carrier=string(value?.carrierName),tracking=string(value?.trackingNumber),parsedDate=new Date(`${date}T00:00:00Z`);const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(parsedDate.valueOf())&&parsedDate.toISOString().slice(0,10)===date;if(!validDate||!carrier||!tracking||carrier.length>100||tracking.length>100)throw new BadRequestException('Valid schedule, carrier and tracking number are required');if(!['ready','scheduled','failed'].includes(current.status))throw new ConflictException('Delivery cannot be scheduled');next='scheduled';event=current.status==='failed'?'rescheduled':'scheduled';detail={scheduledDate:date,carrierName:carrier,trackingNumber:tracking};await db.query("UPDATE shipment_deliveries SET status=$2,scheduled_date=$3,carrier_name=$4,tracking_number=$5,failure_reason=NULL,updated_by=$6,updated_at=now(),version=version+1 WHERE shipment_id=$1",[shipmentId,next,date,carrier,tracking,actorId]);}
      else if(action==='dispatch'){if(current.status!=='scheduled')throw new ConflictException('Only scheduled delivery can dispatch');next='in_transit';event='dispatched';await db.query("UPDATE shipment_deliveries SET status=$2,dispatched_at=now(),updated_by=$3,updated_at=now(),version=version+1 WHERE shipment_id=$1",[shipmentId,next,actorId]);}
      else if(action==='deliver'){const recipient=string(value?.recipientName),method=string(value?.proofMethod),note=string(value?.proofNote);if(!recipient||!['signature','photo','staff_confirmation'].includes(method)||!note||recipient.length>100||note.length>500)throw new BadRequestException('Valid delivery proof is required');if(current.status!=='in_transit')throw new ConflictException('Only in-transit delivery can complete');next='delivered';event='delivered';detail={recipientName:recipient,proofMethod:method,proofNote:note};await db.query("UPDATE shipment_deliveries SET status=$2,delivered_at=now(),recipient_name=$3,proof_method=$4,proof_note=$5,updated_by=$6,updated_at=now(),version=version+1 WHERE shipment_id=$1",[shipmentId,next,recipient,method,note,actorId]);}
      else{const reason=string(value?.reason);if(!reason||reason.length>500)throw new BadRequestException('Valid failure reason is required');if(current.status!=='in_transit')throw new ConflictException('Only in-transit delivery can fail');next='failed';event='failed';detail={reason};await db.query("UPDATE shipment_deliveries SET status=$2,failure_reason=$3,updated_by=$4,updated_at=now(),version=version+1 WHERE shipment_id=$1",[shipmentId,next,reason,actorId]);}
      await db.query('INSERT INTO shipment_delivery_events(id,shipment_id,event_type,actor_id,from_status,to_status,detail) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),shipmentId,event,actorId,current.status,next,JSON.stringify(detail)]);const response={shipmentId,status:next};await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)',[actorId,type,requestId,JSON.stringify(response)]);return response;});
  }

  async pending(pagination: Pagination,filters:OrderFilters={query:'',status:'all'}) {
    try {
      const pendingWhere = `o.status='submitted' OR (o.status='confirmed' AND EXISTS (
        SELECT 1 FROM order_lines l2 LEFT JOIN reservations r2 ON r2.order_line_id=l2.id
        WHERE l2.order_id=o.id AND l2.requested_quantity>COALESCE(r2.shipped_quantity,0)
      ))`;
      const values:unknown[]=[];
      const where=this.filters(filters,values,{submitted:`o.status='submitted'`,confirmed:`o.status='confirmed'`});
      const [count, result] = await Promise.all([
        this.pool.query(`SELECT count(*)::int AS total FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id WHERE (${pendingWhere})${where}`,values),
        this.pool.query(`SELECT o.id,o.status,o.created_at AS "createdAt",o.confirmed_at AS "confirmedAt",
        c.code AS "customerCode",c.name AS "customerName",w.code AS "warehouseCode",
        (SELECT json_build_object('id',cr.id,'reason',cr.reason,'requestedAt',cr.requested_at)
          FROM order_cancellation_requests cr WHERE cr.order_id=o.id AND cr.status='submitted' LIMIT 1) AS "cancellationRequest",
        COALESCE((SELECT json_agg(json_build_object(
          'sku',l.sku,
          'name',l.product_name,
          'saleUnit',l.sale_unit,
          'unitPrice',l.unit_price::text,
          'requestedQuantity',l.requested_quantity,
          'reservedQuantity',l.reserved_quantity,
          'shippedQuantity',COALESCE(r.shipped_quantity,0),
          'remainingReservedQuantity',GREATEST(l.reserved_quantity-COALESCE(r.shipped_quantity,0),0),
          'waitingQuantity',GREATEST(l.requested_quantity-l.reserved_quantity,0)
        ) ORDER BY l.sku)
        FROM order_lines l LEFT JOIN reservations r ON r.order_line_id=l.id WHERE l.order_id=o.id),'[]') AS lines
        FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id
        WHERE (${pendingWhere})${where}
        ORDER BY CASE WHEN o.status='submitted' THEN 0 ELSE 1 END,o.created_at,o.id LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,pagination.pageSize,pagination.offset]),
      ]);
      return pageResult(result.rows, count.rows[0].total, pagination);
    } catch { throw new ServiceUnavailableException('Order service unavailable'); }
  }
}
