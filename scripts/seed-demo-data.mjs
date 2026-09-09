import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import argon2 from 'argon2';
import pg from 'pg';
import { assertNoIntegrityViolations, integritySql } from './lib/operational-integrity.mjs';
import { assertDemoDeploymentTarget, assertDemoTarget, demoDefinition as demo, demoId, validateDemoDefinition } from './lib/demo-seed.mjs';

const args = process.argv.slice(2);
const deployment = args.length === 2 && args[0] === '--deployment' && args[1] === '--confirm-seed=B2B_STM_DEMO';
const development = args.length === 1 && args[0] === '--development';
assert(development || deployment, 'Select an explicit demo seed target');
const deploymentCredentialsPath = '/run/b2b-stm-secrets/demo-credentials.json';
if (deployment) assert.equal(process.env.DEMO_CREDENTIALS_PATH, deploymentCredentialsPath, 'Deployment credential path mismatch');
const credentialsPath = deployment ? pathToFileURL(deploymentCredentialsPath) : new URL('../.demo-credentials.json', import.meta.url);
const temporaryCredentialsPath = deployment ? pathToFileURL(`${deploymentCredentialsPath}.tmp-${process.pid}`) : new URL(`../.demo-credentials.json.tmp-${process.pid}`, import.meta.url);
const credentialsLabel = deployment ? 'server secret credential file' : '.demo-credentials.json';
const password = () => `Demo!${randomBytes(15).toString('base64url')}`;
const occurredAt = daysAgo => new Date(Date.now() - daysAgo * 86_400_000 - 2 * 3_600_000);
const businessDate = daysAgo => new Date(Date.now() - Math.min(daysAgo, 4) * 86_400_000).toISOString().slice(0, 10);

let temporaryCredentialsWritten = false;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000, query_timeout: 30_000 });

try {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  if (deployment) assertDemoDeploymentTarget(process.env.DATABASE_URL);
  else assertDemoTarget(process.env.DATABASE_URL);
  validateDemoDefinition(demo);
  await db.connect();
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('b2b-stm-demo-seed'))");

  const existing = await db.query("SELECT count(*)::int AS count FROM customers WHERE code LIKE 'DEMO-%'");
  if (existing.rows[0].count > 0) {
    assert.equal(existing.rows[0].count, demo.customers.length, 'Unexpected partial DEMO customer data; seed refused');
    const counts = await db.query("SELECT (SELECT count(*)::int FROM products WHERE sku LIKE 'DEMO-%') AS products,(SELECT count(*)::int FROM orders WHERE customer_id=ANY($1::uuid[])) AS orders", [demo.customers.map(item => item.id)]);
    assert.deepEqual(counts.rows[0], { products: demo.products.length, orders: demo.orders.length }, 'Unexpected partial DEMO records; seed refused');
    assert(existsSync(credentialsPath), 'Demo data exists but local credential file is missing');
    await db.query('ROLLBACK');
    console.log(`Demo data already present; no records changed. Credentials: ${credentialsLabel}`);
    process.exit(0);
  }
  assert(!existsSync(credentialsPath), `${credentialsLabel} already exists; seed refused`);

  const accountPasswords = Object.fromEntries(Object.keys(demo.users).map(key => [key, password()]));
  const accountHashes = Object.fromEntries(await Promise.all(Object.entries(accountPasswords).map(async ([key, value]) => [key, await argon2.hash(value, { type: argon2.argon2id })])));
  const credentialDocument = {
    scope: deployment ? 'Zorin deployment only' : 'local development only',
    generatedAt: new Date().toISOString(),
    accounts: Object.fromEntries(Object.entries(demo.users).map(([key, user]) => [key, {
      email: user.email,
      password: accountPasswords[key],
      ...(key === 'operations' ? { note: '첫 로그인에서 MFA 등록 필요' } : {}),
    }])),
  };
  await writeFile(temporaryCredentialsPath, `${JSON.stringify(credentialDocument, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  temporaryCredentialsWritten = true;

  for (const customer of demo.customers) {
    await db.query('INSERT INTO customers(id,code,name) VALUES($1,$2,$3)', [customer.id, customer.code, customer.name]);
  }
  for (const [key, user] of Object.entries(demo.users)) {
    const customerId = user.customerId ?? null;
    const accountType = customerId ? 'customer' : 'internal';
    await db.query('INSERT INTO users(id,email,password_hash,account_type,customer_id) VALUES($1,$2,$3,$4,$5)', [user.id, user.email, accountHashes[key], accountType, customerId]);
    const roles = key.startsWith('customer') ? ['customer'] : key === 'warehouse' ? ['warehouse'] : ['operations', 'settlement'];
    for (const role of roles) await db.query('INSERT INTO user_roles(user_id,account_type,role) VALUES($1,$2,$3)', [user.id, accountType, role]);
  }
  for (const supplier of demo.suppliers) await db.query('INSERT INTO suppliers(id,code,name) VALUES($1,$2,$3)', [supplier.id, supplier.code, supplier.name]);
  await db.query('INSERT INTO warehouses(id,code,name) VALUES($1,$2,$3)', [demo.warehouse.id, demo.warehouse.code, demo.warehouse.name]);
  for (const product of demo.products) {
    await db.query('INSERT INTO products(id,sku,name,sale_unit) VALUES($1,$2,$3,$4)', [product.id, product.sku, product.name, product.saleUnit]);
    await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES($1,$2,$3,$4)', [demo.warehouse.id, product.id, product.onHandQuantity, product.reservedQuantity]);
    for (const [customerIndex, customer] of demo.customers.entries()) {
      await db.query("INSERT INTO customer_prices(customer_id,product_id,unit_price,tax_category,tax_rate_bps) VALUES($1,$2,$3,'taxable',1000)", [customer.id, product.id, product.unitPrice + customerIndex * 500]);
    }
  }

  for (const [supplierIndex, supplier] of demo.suppliers.entries()) {
    const receiptId = demoId(300 + supplierIndex);
    await db.query("INSERT INTO receipts(id,supplier_id,warehouse_id,status,received_at,created_by,created_at) VALUES($1,$2,$3,'confirmed',$4,$5,$4)", [receiptId, supplier.id, demo.warehouse.id, occurredAt(14 - supplierIndex), demo.users.operations.id]);
    for (const [productIndex, product] of demo.products.entries()) {
      if (productIndex % demo.suppliers.length !== supplierIndex || product.receiptQuantity === 0) continue;
      const lineId = demoId(400 + productIndex);
      await db.query('INSERT INTO receipt_lines(id,receipt_id,product_id,quantity) VALUES($1,$2,$3,$4)', [lineId, receiptId, product.id, product.receiptQuantity]);
      await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,receipt_line_id,occurred_at,created_by) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7)", [demoId(500 + productIndex), demo.warehouse.id, product.id, product.receiptQuantity, lineId, occurredAt(14 - supplierIndex), demo.users.operations.id]);
    }
  }

  const customerUsers = [demo.users.customer, demo.users.customerBakery, demo.users.customerKitchen];
  const shipmentLines = new Map();
  let lineSequence = 0;
  let eventSequence = 0;
  let shipmentLineSequence = 0;
  let movementSequence = 20;
  let receivableSequence = 0;
  let deliverySequence = 0;
  const receivablesByOrder = new Map();
  for (const [orderIndex, order] of demo.orders.entries()) {
    const customer = demo.customers[order.customer];
    const requester = customerUsers[order.customer];
    const confirmed = order.status !== 'submitted';
    const createdAt = occurredAt(order.daysAgo);
    await db.query(`INSERT INTO orders(id,customer_id,warehouse_id,status,requested_by,confirmed_by,confirmed_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [order.id, customer.id, demo.warehouse.id, order.status, requester.id, confirmed ? demo.users.operations.id : null, confirmed ? new Date(createdAt.getTime() + 30 * 60_000) : null, createdAt]);
    const shippedLines = [];
    for (const [orderLineIndex, line] of order.lines.entries()) {
      const product = demo.products[line.product];
      const orderLineId = demoId(600 + lineSequence++);
      const unitPrice = product.unitPrice + order.customer * 500;
      await db.query(`INSERT INTO order_lines(id,order_id,product_id,sku,product_name,sale_unit,requested_quantity,reserved_quantity,unit_price,tax_category,tax_rate_bps)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'taxable',1000)`, [orderLineId, order.id, product.id, product.sku, product.name, product.saleUnit, line.requested, line.reservationStatus === 'released' ? line.shipped : line.reserved, unitPrice]);
      if (line.reserved > 0) {
        const reservationId = demoId(700 + orderIndex * 10 + orderLineIndex);
        await db.query(`INSERT INTO reservations(id,order_line_id,warehouse_id,product_id,quantity,status,shipped_quantity,created_by,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [reservationId, orderLineId, demo.warehouse.id, product.id, line.reserved, line.reservationStatus, line.shipped, demo.users.operations.id, new Date(createdAt.getTime() + 30 * 60_000)]);
        await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by,created_at) VALUES($1,$2,'created',$3,$4,$5)", [demoId(800 + eventSequence++), reservationId, line.reserved, demo.users.operations.id, new Date(createdAt.getTime() + 30 * 60_000)]);
        if (line.shipped > 0) shippedLines.push({ reservationId, orderLineId, product, quantity: line.shipped, unitPrice, lineKey: `${orderIndex}:${orderLineIndex}` });
        if (line.shipped > 0) await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by,created_at) VALUES($1,$2,'shipped',$3,$4,$5)", [demoId(800 + eventSequence++), reservationId, line.shipped, demo.users.warehouse.id, new Date(createdAt.getTime() + 60 * 60_000)]);
        if (line.reservationStatus === 'released' && line.reserved > line.shipped) await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by,created_at) VALUES($1,$2,'released',$3,$4,$5)", [demoId(800 + eventSequence++), reservationId, line.reserved - line.shipped, demo.users.operations.id, new Date(createdAt.getTime() + 90 * 60_000)]);
      }
    }
    if (shippedLines.length) {
      const shipmentId = demoId(900 + orderIndex);
      const shippedAt = new Date(createdAt.getTime() + 60 * 60_000);
      await db.query("INSERT INTO shipments(id,order_id,warehouse_id,status,shipped_by,shipped_at,created_at) VALUES($1,$2,$3,'shipped',$4,$5,$5)", [shipmentId, order.id, demo.warehouse.id, demo.users.warehouse.id, shippedAt]);
      const deliveryStatus = ['delivered', 'in_transit', 'scheduled'][deliverySequence++ % 3];
      const scheduledDate = new Date(shippedAt.getTime() + 24 * 60 * 60_000).toISOString().slice(0, 10);
      const dispatchedAt = deliveryStatus === 'scheduled' ? null : new Date(shippedAt.getTime() + 4 * 60 * 60_000);
      const deliveredAt = deliveryStatus === 'delivered' ? new Date(shippedAt.getTime() + 28 * 60 * 60_000) : null;
      const trackingNumber = `STM-DEMO-${String(orderIndex + 1).padStart(4, '0')}`;
      await db.query(`INSERT INTO shipment_deliveries(shipment_id,status,scheduled_date,carrier_name,tracking_number,dispatched_at,delivered_at,recipient_name,proof_method,proof_note,updated_by,updated_at)
        VALUES($1,$2,$3,'한진택배',$4,$5,$6,$7,$8,$9,$10,COALESCE($6::timestamptz,$5::timestamptz,$11::timestamptz))`, [shipmentId, deliveryStatus, scheduledDate, trackingNumber, dispatchedAt, deliveredAt, deliveredAt ? customer.name : null, deliveredAt ? 'staff_confirmation' : null, deliveredAt ? '매장 담당자 직접 인수' : null, demo.users.warehouse.id, shippedAt]);
      const deliveryEvents = [
        ['created', null, 'ready', shippedAt, {}],
        ['scheduled', 'ready', 'scheduled', new Date(shippedAt.getTime() + 30 * 60_000), { scheduledDate, carrierName: '한진택배', trackingNumber }],
        ...(dispatchedAt ? [['dispatched', 'scheduled', 'in_transit', dispatchedAt, {}]] : []),
        ...(deliveredAt ? [['delivered', 'in_transit', 'delivered', deliveredAt, { recipientName: customer.name, proofMethod: 'staff_confirmation', proofNote: '매장 담당자 직접 인수' }]] : []),
      ];
      for (const [eventIndex, event] of deliveryEvents.entries()) await db.query('INSERT INTO shipment_delivery_events(id,shipment_id,event_type,actor_id,from_status,to_status,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [demoId(1800 + orderIndex * 10 + eventIndex), shipmentId, event[0], demo.users.warehouse.id, event[1], event[2], event[4], event[3]]);
      const orderReceivables = [];
      for (const shipped of shippedLines) {
        const shipmentLineId = demoId(1000 + shipmentLineSequence++);
        const receivableId = demoId(1200 + receivableSequence++);
        await db.query('INSERT INTO shipment_lines(id,shipment_id,reservation_id,quantity) VALUES($1,$2,$3,$4)', [shipmentLineId, shipmentId, shipped.reservationId, shipped.quantity]);
        await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,shipment_line_id,occurred_at,created_by) VALUES($1,$2,$3,'shipment',$4,$5,$6,$7)", [demoId(1100 + movementSequence++), demo.warehouse.id, shipped.product.id, -shipped.quantity, shipmentLineId, shippedAt, demo.users.warehouse.id]);
        const supplyAmount = shipped.quantity * shipped.unitPrice;
        const taxAmount = Math.floor((supplyAmount * 1000 + 5000) / 10000);
        const amount = supplyAmount + taxAmount;
        await db.query("INSERT INTO receivable_entries(id,customer_id,shipment_line_id,business_date,entry_type,quantity,unit_price,supply_amount,tax_amount,amount,tax_category,tax_rate_bps,created_at) VALUES($1,$2,$3,$4,'shipment',$5,$6,$7,$8,$9,'taxable',1000,$10)", [receivableId, customer.id, shipmentLineId, businessDate(order.daysAgo), shipped.quantity, shipped.unitPrice, supplyAmount, taxAmount, amount, shippedAt]);
        shipmentLines.set(shipped.lineKey, { shipmentId, shipmentLineId, product: shipped.product });
        orderReceivables.push({ id: receivableId, supplyAmount, taxAmount, amount });
      }
      receivablesByOrder.set(orderIndex, orderReceivables);
    }
    if (order.cancellationRequest) {
      const approved = order.cancellationRequest === 'approved';
      const requestId = demoId(1300 + orderIndex);
      await db.query(`INSERT INTO order_cancellation_requests(id,order_id,reason,status,requested_by,requested_at,reviewed_by,reviewed_at,review_note,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [requestId, order.id, approved ? '매장 운영 일정 변경으로 잔량 취소 요청' : '프로모션 일정 취소로 미출고 잔량 취소 요청', order.cancellationRequest, requester.id, new Date(createdAt.getTime() + 90 * 60_000), approved ? demo.users.operations.id : null, approved ? new Date(createdAt.getTime() + 120 * 60_000) : null, null, approved ? new Date(createdAt.getTime() + 120 * 60_000) : new Date(createdAt.getTime() + 90 * 60_000)]);
      if (approved) await db.query('INSERT INTO order_cancellations(order_id,reason,cancelled_by,cancelled_at) VALUES($1,$2,$3,$4)', [order.id, '매장 운영 일정 변경으로 잔량 취소 요청', demo.users.operations.id, new Date(createdAt.getTime() + 120 * 60_000)]);
    }
  }

  const assignedDemoOrder = demo.orders[2];
  await db.query('INSERT INTO shipment_work_assignments(order_id,assigned_to,assigned_at,updated_at) VALUES($1,$2,$3,$3)', [assignedDemoOrder.id, demo.users.warehouse.id, occurredAt(0)]);
  await db.query("INSERT INTO shipment_work_assignment_events(id,order_id,event_type,actor_id,assignee_id,created_at) VALUES($1,$2,'claimed',$3,$3,$4)", [demoId(1700), assignedDemoOrder.id, demo.users.warehouse.id, occurredAt(0)]);
  const assignedReservations = await db.query(`SELECT r.id,LEAST(r.quantity-r.shipped_quantity,4)::int AS picked,LEAST(r.quantity-r.shipped_quantity,2)::int AS inspected
    FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=$1 AND r.status='active' ORDER BY l.sku`, [assignedDemoOrder.id]);
  for (const [index, line] of assignedReservations.rows.entries()) {
    await db.query('INSERT INTO shipment_work_lines(reservation_id,picked_quantity,inspected_quantity,updated_by,picked_at,inspected_at,updated_at) VALUES($1,$2,$3,$4,$5,$5,$5)', [line.id, line.picked, line.inspected, demo.users.warehouse.id, occurredAt(0)]);
    await db.query("INSERT INTO shipment_work_line_events(id,reservation_id,event_type,actor_id,previous_picked_quantity,picked_quantity,previous_inspected_quantity,inspected_quantity,created_at) VALUES($1,$2,'picked',$3,0,$4,0,0,$5)", [demoId(1710 + index * 2), line.id, demo.users.warehouse.id, line.picked, occurredAt(0)]);
    await db.query("INSERT INTO shipment_work_line_events(id,reservation_id,event_type,actor_id,previous_picked_quantity,picked_quantity,previous_inspected_quantity,inspected_quantity,created_at) VALUES($1,$2,'inspected',$3,$4,$4,0,$5,$6)", [demoId(1711 + index * 2), line.id, demo.users.warehouse.id, line.picked, line.inspected, occurredAt(0)]);
  }

  const activeCountProduct = demo.products.at(-1);
  const activeCountBalance = (await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2',[demo.warehouse.id,activeCountProduct.id])).rows[0];
  await db.query("INSERT INTO stock_counts(id,warehouse_id,product_id,status,snapshot_on_hand_quantity,snapshot_reserved_quantity,reason,started_by,started_at) VALUES($1,$2,$3,'counting',$4,$5,'분기 정기 실사 진행',$6,now()-interval '25 minutes')",[demoId(1900),demo.warehouse.id,activeCountProduct.id,activeCountBalance.on_hand_quantity,activeCountBalance.reserved_quantity,demo.users.operations.id]);
  const closedCountProduct = demo.products.at(-2);
  const closedCountBalance = (await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2',[demo.warehouse.id,closedCountProduct.id])).rows[0];
  const countAdjustmentId=demoId(1902);
  await db.query("INSERT INTO inventory_adjustments(id,warehouse_id,product_id,quantity_delta,reason,adjusted_by,adjusted_at) VALUES($1,$2,$3,-3,'실사 확정: 파손 3개 확인',$4,now()-interval '2 days')",[countAdjustmentId,demo.warehouse.id,closedCountProduct.id,demo.users.operations.id]);
  await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,adjustment_id,occurred_at,created_by) VALUES($1,$2,$3,'adjustment',-3,$4,now()-interval '2 days',$5)",[demoId(1903),demo.warehouse.id,closedCountProduct.id,countAdjustmentId,demo.users.operations.id]);
  await db.query("INSERT INTO stock_counts(id,warehouse_id,product_id,status,snapshot_on_hand_quantity,snapshot_reserved_quantity,counted_quantity,reason,started_by,started_at,finalized_by,finalized_at,adjustment_id) VALUES($1,$2,$3,'finalized',$4,$5,$6,'파손 3개 확인',$7,now()-interval '2 days 30 minutes',$7,now()-interval '2 days',$8)",[demoId(1901),demo.warehouse.id,closedCountProduct.id,closedCountBalance.on_hand_quantity+3,closedCountBalance.reserved_quantity,closedCountBalance.on_hand_quantity,demo.users.operations.id,countAdjustmentId]);

  const completedShipment = shipmentLines.get('4:0');
  assert(completedShipment, 'Completed shipment sample missing');
  await db.query("INSERT INTO returns(id,customer_id,shipment_id,status,requested_by,requested_at,updated_at) VALUES($1,$2,$3,'requested',$4,$5,$5)", [demoId(1400), demo.customers[1].id, completedShipment.shipmentId, demo.users.customerBakery.id, occurredAt(1)]);
  await db.query('INSERT INTO return_lines(id,return_id,shipment_line_id,product_id,reason,requested_quantity,received_quantity,defective_quantity) VALUES($1,$2,$3,$4,$5,3,2,2)', [demoId(1401), demoId(1400), completedShipment.shipmentLineId, completedShipment.product.id, '배송 중 포장 눌림 확인']);
  await db.query("UPDATE returns SET status='inspecting' WHERE id=$1",[demoId(1400)]);
  await db.query("INSERT INTO return_inspections(id,return_line_id,received_quantity,normal_quantity,defective_quantity,defective_reason,inspected_by,inspected_at) VALUES($1,$2,2,0,2,'외포장 파손',$3,now()-interval '20 hours')",[demoId(1402),demoId(1401),demo.users.warehouse.id]);
  await db.query("INSERT INTO return_defect_dispositions(id,return_inspection_id,quantity,disposition,reason,decided_by,created_at) VALUES($1,$2,1,'quarantine','공급처 확인 대기',$3,now()-interval '18 hours')",[demoId(1403),demoId(1402),demo.users.operations.id]);
  await db.query("INSERT INTO return_defect_dispositions(id,return_inspection_id,quantity,disposition,reason,decided_by,supplier_id,external_reference,created_at) VALUES($1,$2,1,'supplier_return','공급처 책임 불량 반송',$3,$4,'DEMO-SUP-RETURN-001',now()-interval '17 hours')",[demoId(1404),demoId(1402),demo.users.operations.id,demo.suppliers[0].id]);
  const evidence=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),evidenceHash=createHash('sha256').update(evidence).digest('hex');
  await db.query("INSERT INTO business_attachments(id,resource_type,resource_id,customer_id,filename,media_type,byte_size,sha256,content,uploaded_by,created_at) VALUES($1,'shipment',$2,$3,'DEMO-인수증빙.png','image/png',$4,$5,$6,$7,now()-interval '22 hours')",[demoId(1950),completedShipment.shipmentId,demo.customers[1].id,evidence.length,evidenceHash,evidence,demo.users.warehouse.id]);
  await db.query("INSERT INTO business_attachments(id,resource_type,resource_id,customer_id,filename,media_type,byte_size,sha256,content,uploaded_by,created_at) VALUES($1,'return',$2,$3,'DEMO-반품파손.png','image/png',$4,$5,$6,$7,now()-interval '21 hours')",[demoId(1951),demoId(1400),demo.customers[1].id,evidence.length,evidenceHash,evidence,demo.users.customerBakery.id]);

  const period = new Date().toISOString().slice(0, 7) + '-01';
  const draftSettlementId = demoId(1500);
  const draftEntries=receivablesByOrder.get(1)??[],draftSupply=draftEntries.reduce((sum,entry)=>sum+entry.supplyAmount,0),draftTax=draftEntries.reduce((sum,entry)=>sum+entry.taxAmount,0),draftTotal=draftEntries.reduce((sum,entry)=>sum+entry.amount,0);
  await db.query("INSERT INTO settlements(id,customer_id,period,status,created_by,supply_amount,tax_amount,total_amount,payment_due_day) VALUES($1,$2,$3,'draft',$4,$5,$6,$7,10)", [draftSettlementId, demo.customers[0].id, period, demo.users.operations.id,draftSupply,draftTax,draftTotal]);
  for (const [index, entry] of draftEntries.entries()) await db.query('INSERT INTO settlement_lines(id,settlement_id,receivable_entry_id,supply_amount,tax_amount,amount) VALUES($1,$2,$3,$4,$5,$6)', [demoId(1510 + index), draftSettlementId, entry.id, entry.supplyAmount,entry.taxAmount,entry.amount]);
  const finalizedSettlementId = demoId(1501);
  const finalizedEntries=receivablesByOrder.get(4)??[],finalizedSupply=finalizedEntries.reduce((sum,entry)=>sum+entry.supplyAmount,0),finalizedTax=finalizedEntries.reduce((sum,entry)=>sum+entry.taxAmount,0),finalizedTotal=finalizedEntries.reduce((sum,entry)=>sum+entry.amount,0);
  await db.query("INSERT INTO settlements(id,customer_id,period,status,created_by,finalized_by,finalized_at,supply_amount,tax_amount,total_amount,payment_due_day,due_date) VALUES($1,$2,$3,'finalized',$4,$4,now()-interval '2 days',$5,$6,$7,10,(date_trunc('month',$3::date)+interval '1 month 9 days')::date)", [finalizedSettlementId, demo.customers[1].id, period, demo.users.operations.id,finalizedSupply,finalizedTax,finalizedTotal]);
  const finalizedDueDate=(await db.query('SELECT due_date::text AS "dueDate" FROM settlements WHERE id=$1',[finalizedSettlementId])).rows[0].dueDate;
  for (const [index, entry] of finalizedEntries.entries()) await db.query('INSERT INTO settlement_lines(id,settlement_id,receivable_entry_id,supply_amount,tax_amount,amount) VALUES($1,$2,$3,$4,$5,$6)', [demoId(1520 + index), finalizedSettlementId, entry.id, entry.supplyAmount,entry.taxAmount,entry.amount]);

  await db.query("INSERT INTO payments(id,customer_id,payment_date,amount,reference,status,recorded_by) VALUES($1,$2,CURRENT_DATE-1,$3,'DEMO-BANK-BAKERY','recorded',$4)", [demoId(1600), demo.customers[1].id, finalizedTotal, demo.users.operations.id]);
  await db.query('INSERT INTO payment_allocations(id,payment_id,settlement_id,amount) VALUES($1,$2,$3,$4)', [demoId(1610), demoId(1600), finalizedSettlementId, (receivablesByOrder.get(4) ?? []).reduce((sum, entry) => sum + entry.amount, 0)]);
  await db.query("INSERT INTO payments(id,customer_id,payment_date,amount,reference,status,recorded_by) VALUES($1,$2,CURRENT_DATE,120000,'DEMO-BANK-KITCHEN','recorded',$3)", [demoId(1601), demo.customers[2].id, demo.users.operations.id]);
  await db.query("INSERT INTO refunds(id,customer_id,source_type,payment_id,refund_date,amount,method,reference,reason,recorded_by,recorded_at) VALUES($1,$2,'payment',$3,CURRENT_DATE,20000,'bank_transfer','DEMO-REFUND-001','초과 입금 반환',$4,now()-interval '2 hours')",[demoId(1620),demo.customers[2].id,demoId(1601),demo.users.operations.id]);

  await db.query(`INSERT INTO notification_outbox(id,event_type,aggregate_type,aggregate_id,recipient_user_id,recipient_email,subject,body,status,created_at,updated_at)
    VALUES($1,'order_submitted','order',$2,$3,$4,'[STM] 신규 주문 접수',$5,'pending',now()-interval '8 minutes',now()-interval '8 minutes')`,[demoId(1960),demo.orders[0].id,demo.users.operations.id,demo.users.operations.email,`주문 번호: ${demo.orders[0].id}\n관리자 주문 화면에서 확인해 주세요.`]);
  await db.query(`INSERT INTO notification_outbox(id,event_type,aggregate_type,aggregate_id,recipient_user_id,recipient_email,subject,body,status,attempts,sent_at,provider_message_id,created_at,updated_at)
    VALUES($1,'shipment_created','shipment',$2,$3,$4,'[STM] 출고 처리 안내',$5,'sent',1,now()-interval '1 day','demo-message-001',now()-interval '1 day',now()-interval '1 day')`,[demoId(1961),completedShipment.shipmentId,demo.users.customerBakery.id,demo.users.customerBakery.email,`출고 번호: ${completedShipment.shipmentId}\n출고 수량: ${demo.orders[4].lines[0].shipped}\n거래처 포털에서 배송 상태를 확인해 주세요.`]);
  await db.query(`INSERT INTO notification_outbox(id,event_type,aggregate_type,aggregate_id,recipient_user_id,recipient_email,subject,body,status,attempts,next_attempt_at,last_error_code,created_at,updated_at)
    VALUES($1,'settlement_finalized','settlement',$2,$3,$4,'[STM] 월 정산 마감',$5,'failed',3,now()+interval '30 minutes','delivery_failed',now()-interval '2 hours',now()-interval '10 minutes')`,[demoId(1962),finalizedSettlementId,demo.users.customerBakery.id,demo.users.customerBakery.email,`정산월: ${period.slice(0,7)}\n청구액: ${finalizedTotal}원\n지급 기한: ${finalizedDueDate}\n거래처 포털에서 거래명세서를 확인해 주세요.`]);

  const integrity = (await db.query(integritySql)).rows[0].result;
  assertNoIntegrityViolations(integrity);
  const verification = await db.query("SELECT (SELECT count(*)::int FROM customers WHERE code LIKE 'DEMO-%') AS customers,(SELECT count(*)::int FROM products WHERE sku LIKE 'DEMO-%') AS products,(SELECT count(*)::int FROM orders WHERE customer_id=ANY($1::uuid[])) AS orders,(SELECT count(*)::int FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.customer_id=ANY($1::uuid[])) AS returns", [demo.customers.map(item => item.id)]);
  assert.deepEqual(verification.rows[0], { customers: 3, products: 12, orders: 6, returns: 1 });
  await db.query('COMMIT');
  await rename(temporaryCredentialsPath, credentialsPath);
  temporaryCredentialsWritten = false;
  console.log('Demo data created: 3 customers, 12 products, 6 orders, 1 assigned shipment work, 1 pending return, 2 defect dispositions, 2 settlements, 2 payments, 1 refund, 3 notifications');
  console.log(`Credentials: ${credentialsLabel}`);
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  const databaseError = error && typeof error === 'object' ? error : {};
  const safeMessage = error instanceof Error && error.name === 'AssertionError'
    ? error.message
    : `Demo seed failed; transaction rolled back (${databaseError.code ?? 'unknown'}${databaseError.constraint ? `: ${databaseError.constraint}` : ''})`;
  console.error(safeMessage);
  process.exitCode = 1;
} finally {
  if (temporaryCredentialsWritten) await unlink(temporaryCredentialsPath).catch(() => {});
  await db.end().catch(() => {});
}
