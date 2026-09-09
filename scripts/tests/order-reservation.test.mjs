import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import pg from 'pg';
import { csrfHeaders } from './helpers/csrf.mjs';

const { createApplication } = createRequire(import.meta.url)('../../apps/api/dist/application.js');
const ExcelJS = createRequire(import.meta.url)('exceljs');
const digest = value => createHash('sha256').update(value).digest('hex');
const orderItems = async response => (await response.json()).items;
async function prepareShipment(post, orderId, reservationId, quantity, headers) {
  assert.equal((await post(`/api/warehouse/shipments/orders/${orderId}/claim`, { requestId: randomUUID() }, headers)).status, 201);
  assert.equal((await post(`/api/warehouse/shipments/orders/${orderId}/pick`, { requestId: randomUUID(), lines: [{ reservationId, quantity }] }, headers)).status, 201);
  assert.equal((await post(`/api/warehouse/shipments/orders/${orderId}/inspect`, { requestId: randomUUID(), lines: [{ reservationId, quantity }] }, headers)).status, 201);
}

async function withClamd(run) {
  const command=Buffer.from('zINSTREAM\0');
  let scans=0;
  const server=createServer(socket=>{
    let request=Buffer.alloc(0),responded=false;
    socket.on('data',chunk=>{
      if(responded)return;
      request=Buffer.concat([request,chunk]);
      if(request.length<command.length||!request.subarray(0,command.length).equals(command))return;
      let offset=command.length;const chunks=[];
      while(request.length>=offset+4){
        const length=request.readUInt32BE(offset);offset+=4;
        if(length===0){responded=true;scans++;const content=Buffer.concat(chunks);socket.end(`stream: ${content.includes(Buffer.from('EICAR'))?'Eicar-Signature FOUND':'OK'}\0`);return;}
        if(request.length<offset+length)return;
        chunks.push(request.subarray(offset,offset+length));offset+=length;
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await run({port:server.address().port,scanCount:()=>scans});}finally{await new Promise(resolve=>server.close(resolve));}
}

async function fixture(run,env={}) {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const customerId = randomUUID(), customerUserId = randomUUID(), operatorId = randomUUID(), warehouseUserId = randomUUID(), warehouseUser2Id = randomUUID();
  const warehouseId = randomUUID(), productId = randomUUID(), supplierId = randomUUID();
  const customerSession = randomBytes(32).toString('hex'), operatorSession = randomBytes(32).toString('hex'), warehouseSession = randomBytes(32).toString('hex'), warehouseSession2 = randomBytes(32).toString('hex');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL,...env });
  await db.connect();
  try {
    await db.query("INSERT INTO customers(id,code,name) VALUES ($1,$2,'Test customer')", [customerId, `CUST-${suffix}`]);
    await db.query("INSERT INTO users(id,email,account_type,customer_id) VALUES ($1,$2,'customer',$3),($4,$5,'internal',NULL),($6,$7,'internal',NULL),($8,$9,'internal',NULL)", [customerUserId, `customer-${suffix.toLowerCase()}@example.test`, customerId, operatorId, `operator-${suffix.toLowerCase()}@example.test`, warehouseUserId, `warehouse-${suffix.toLowerCase()}@example.test`, warehouseUser2Id, `warehouse2-${suffix.toLowerCase()}@example.test`]);
    await db.query("INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,'customer','customer'),($2,'internal','operations'),($2,'internal','settlement'),($3,'internal','warehouse'),($4,'internal','warehouse')", [customerUserId, operatorId, warehouseUserId, warehouseUser2Id]);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,mfa_verified_at) VALUES ($1,$2,now()+interval '12 hours',NULL),($3,$4,now()+interval '12 hours',now()),($5,$6,now()+interval '12 hours',NULL),($7,$8,now()+interval '12 hours',NULL)", [digest(customerSession), customerUserId, digest(operatorSession), operatorId, digest(warehouseSession), warehouseUserId, digest(warehouseSession2), warehouseUser2Id]);
    await db.query("INSERT INTO warehouses(id,code,name) VALUES ($1,$2,'Main warehouse')", [warehouseId, `WH-${suffix}`]);
    await db.query("INSERT INTO suppliers(id,code,name) VALUES ($1,$2,'Test supplier')", [supplierId, `SUP-${suffix}`]);
    await db.query("INSERT INTO products(id,sku,name,sale_unit) VALUES ($1,$2,'Test cup','box')", [productId, `SKU-${suffix}`]);
    await db.query("INSERT INTO customer_prices(customer_id,product_id,unit_price,tax_category,tax_rate_bps) VALUES ($1,$2,10000,'exempt',0)", [customerId, productId]);
    await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity) VALUES ($1,$2,5)', [warehouseId, productId]);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const customerHeaders = await csrfHeaders(base, `b2b_session=${customerSession}`);
    const operatorHeaders = await csrfHeaders(base, `b2b_session=${operatorSession}`);
    const warehouseHeaders = await csrfHeaders(base, `b2b_session=${warehouseSession}`);
    const warehouseHeaders2 = await csrfHeaders(base, `b2b_session=${warehouseSession2}`);
    const post = (path, body, headers) => fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await run({ db, customerId, customerUserId, operatorId, warehouseUserId, warehouseUser2Id, warehouseId, supplierId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, warehouseHeaders2, post });
  } finally {
    const orderIds = (await db.query('SELECT id FROM orders WHERE customer_id=$1', [customerId])).rows.map(row => row.id);
    if (orderIds.length) {
      await db.query('DELETE FROM notification_outbox WHERE aggregate_id=ANY($1::uuid[]) OR aggregate_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM stock_count_reservation_adjustments WHERE stock_count_id IN (SELECT id FROM stock_counts WHERE warehouse_id=$1)',[warehouseId]);
      await db.query('DELETE FROM stock_counts WHERE warehouse_id=$1',[warehouseId]);
      await db.query('DELETE FROM shipment_work_line_events WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM shipment_work_lines WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM shipment_work_assignment_events WHERE order_id=ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM shipment_work_assignments WHERE order_id=ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM payment_allocation_reversals WHERE payment_allocation_id IN (SELECT id FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE customer_id=$1))', [customerId]);
      await db.query('DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE customer_id=$1)', [customerId]);
      await db.query('DELETE FROM settlement_lines WHERE receivable_entry_id IN (SELECT id FROM receivable_entries WHERE customer_id=$1)', [customerId]);
      await db.query('DELETE FROM settlements WHERE customer_id=$1', [customerId]);
      await db.query('DELETE FROM receivable_entries WHERE refund_id IN (SELECT id FROM refunds WHERE customer_id=$1)',[customerId]);
      await db.query('DELETE FROM refunds WHERE customer_id=$1',[customerId]);
      await db.query('DELETE FROM payments WHERE customer_id=$1', [customerId]);
      await db.query('DELETE FROM receivable_entries WHERE return_credit_id IN (SELECT rc.id FROM return_credits rc JOIN returns r ON r.id=(SELECT rl.return_id FROM return_lines rl WHERE rl.id=rc.return_line_id) WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
      await db.query('DELETE FROM return_credits WHERE return_line_id IN (SELECT rl.id FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
      await db.query('DELETE FROM receivable_entries WHERE shipment_line_id IN (SELECT sl.id FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM return_defect_resolutions WHERE quarantine_disposition_id IN (SELECT d.id FROM return_defect_dispositions d JOIN return_inspections ri ON ri.id=d.return_inspection_id JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))',[orderIds]);
      await db.query('DELETE FROM return_defect_dispositions WHERE return_inspection_id IN (SELECT ri.id FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
      await db.query('DELETE FROM inventory_movements WHERE return_inspection_id IN (SELECT ri.id FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
      await db.query('DELETE FROM return_inspections WHERE return_line_id IN (SELECT rl.id FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
      await db.query('DELETE FROM return_lines WHERE return_id IN (SELECT r.id FROM returns r WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
      await db.query('DELETE FROM returns WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM inventory_movements WHERE shipment_line_id IN (SELECT sl.id FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM shipment_delivery_events WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM shipment_deliveries WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM shipment_lines WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM shipments WHERE order_id=ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM reservation_events WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM reservations WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id=ANY($1::uuid[]))', [orderIds]);
      await db.query('DELETE FROM order_cancellation_requests WHERE order_id=ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM order_cancellations WHERE order_id=ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM order_lines WHERE order_id=ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM orders WHERE id=ANY($1::uuid[])', [orderIds]);
    }
    await db.query('DELETE FROM command_results WHERE actor_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId, warehouseUser2Id]]);
    await db.query('DELETE FROM inventory_movements WHERE receipt_line_id IN (SELECT id FROM receipt_lines WHERE receipt_id IN (SELECT id FROM receipts WHERE supplier_id=$1 AND warehouse_id=$2))', [supplierId, warehouseId]);
    await db.query('DELETE FROM receipt_lines WHERE receipt_id IN (SELECT id FROM receipts WHERE supplier_id=$1 AND warehouse_id=$2)', [supplierId, warehouseId]);
    await db.query('DELETE FROM receipts WHERE supplier_id=$1 AND warehouse_id=$2', [supplierId, warehouseId]);
    await db.query('DELETE FROM inventory_movements WHERE adjustment_id IN (SELECT id FROM inventory_adjustments WHERE warehouse_id=$1)', [warehouseId]);
    await db.query('DELETE FROM inventory_adjustments WHERE warehouse_id=$1', [warehouseId]);
    await db.query('DELETE FROM inventory_balances WHERE warehouse_id=$1', [warehouseId]);
    await db.query('DELETE FROM customer_prices WHERE customer_id=$1 AND product_id=$2', [customerId, productId]);
    await db.query('DELETE FROM products WHERE id=$1', [productId]);
    await db.query('DELETE FROM suppliers WHERE id=$1', [supplierId]);
    await db.query('DELETE FROM warehouses WHERE id=$1', [warehouseId]);
    await db.query('DELETE FROM business_attachments WHERE customer_id=$1', [customerId]);
    await db.query('DELETE FROM data_exports WHERE actor_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId, warehouseUser2Id]]);
    await db.query('DELETE FROM notification_outbox WHERE recipient_user_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId, warehouseUser2Id]]);
    await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId, warehouseUser2Id]]);
    await db.query('DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId, warehouseUser2Id]]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId, warehouseUser2Id]]);
    await db.query('DELETE FROM customers WHERE id=$1', [customerId]);
    await db.end();
    await app.close();
  }
}

test('customer order waits for approval and approval reserves only available stock', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, post }) => {
  const catalog = await fetch(`${base}/api/orders/catalog`, { headers: customerHeaders });
  assert.equal(catalog.status, 200);
  const catalogBody = await catalog.json();
  assert(catalogBody.warehouses.some(warehouse => warehouse.id === warehouseId));
  const product = catalogBody.products.find(item => item.id === productId);
  assert.equal(product.warehouseId, warehouseId);
  assert.equal(product.availableQuantity, 5);
  assert.equal(product.unitPrice, '10000');
  const submitted = await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 8 }] }, customerHeaders);
  assert.equal(submitted.status, 201);
  const order = await submitted.json();
  assert.equal(order.status, 'submitted');
  const customerPage = await (await fetch(`${base}/api/orders?page=1&pageSize=1`, { headers: customerHeaders })).json();
  assert.deepEqual({ page: customerPage.page, pageSize: customerPage.pageSize, total: customerPage.total, totalPages: customerPage.totalPages }, { page: 1, pageSize: 1, total: 1, totalPages: 1 });
  assert.equal(customerPage.items[0].id, order.id);
  assert.equal((await fetch(`${base}/api/orders?page=1&pageSize=101`, { headers: customerHeaders })).status, 400);
  assert.equal((await db.query('SELECT unit_price FROM order_lines WHERE order_id=$1', [order.id])).rows[0].unit_price, '10000');
  assert.equal((await db.query('SELECT reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0].reserved_quantity, 0);
  const confirmed = await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders);
  assert.equal(confirmed.status, 201);
  assert.deepEqual(await confirmed.json(), { id: order.id, status: 'confirmed', reservedQuantity: 5, unreservedQuantity: 3 });
  assert.equal((await db.query('SELECT reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0].reserved_quantity, 5);
}));

test('administrator exports filtered operational data as safe CSV and real XLSX', () => fixture(async ({ db, operatorId, warehouseId, productId, base, customerHeaders, operatorHeaders, post }) => {
  await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 2 }] }, customerHeaders);
  assert.equal((await fetch(`${base}/api/admin/exports/orders?format=csv&status=submitted`, { headers: customerHeaders })).status, 403);
  const csvResponse = await fetch(`${base}/api/admin/exports/orders?format=csv&status=submitted`, { headers: operatorHeaders });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-type') ?? '', /^text\/csv/);
  assert.match(csvResponse.headers.get('content-disposition') ?? '', /attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"/);
  const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = csvBytes.toString('utf8');
  assert.match(csv, /주문일시,주문 ID,거래처 코드/);
  assert.match(csv, /Test customer/);

  const xlsxResponse = await fetch(`${base}/api/admin/exports/inventory?format=xlsx`, { headers: operatorHeaders });
  assert.equal(xlsxResponse.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await xlsxResponse.arrayBuffer()));
  const sheet = workbook.getWorksheet('재고 현황');
  assert(sheet);
  assert.equal(sheet.getCell('A1').value, '창고 코드');
  assert.equal(sheet.rowCount >= 2, true);
  assert.equal(typeof sheet.getCell('F2').value, 'number');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM data_exports WHERE actor_id=$1', [operatorId])).rows[0].count, 2);
}));

test('business attachments validate content, malware scan and customer ownership', () => withClamd(({port,scanCount})=>fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 1 }] }, customerHeaders)).json();
  await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  await prepareShipment(post, order.id, reservationId, 1, warehouseHeaders);
  const shipment = await (await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 1 }] }, warehouseHeaders)).json();
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
  const invalid = await fetch(`${base}/api/attachments/shipment/${shipment.id}?filename=proof.png`, { method: 'POST', headers: { ...warehouseHeaders, 'content-type': 'image/png' }, body: Buffer.from('not a png') });
  assert.equal(invalid.status, 400);
  const infected = await fetch(`${base}/api/attachments/shipment/${shipment.id}?filename=infected.png`, { method: 'POST', headers: { ...warehouseHeaders, 'content-type': 'image/png' }, body: Buffer.concat([png,Buffer.from('EICAR')]) });
  assert.equal(infected.status, 400);
  assert.equal(scanCount(),1);
  assert.equal((await db.query('SELECT count(*)::int count FROM business_attachments WHERE resource_type=$1 AND resource_id=$2',['shipment',shipment.id])).rows[0].count,0);
  const uploaded = await fetch(`${base}/api/attachments/shipment/${shipment.id}?filename=${encodeURIComponent('인수증빙.png')}`, { method: 'POST', headers: { ...warehouseHeaders, 'content-type': 'image/png' }, body: png });
  assert.equal(uploaded.status, 201);
  const attachment = await uploaded.json();
  assert.equal((await fetch(`${base}/api/attachments/shipment/${shipment.id}`, { headers: customerHeaders })).status, 200);
  assert.equal((await fetch(`${base}/api/attachments/shipment/${shipment.id}?filename=x.png`, { method: 'POST', headers: { ...customerHeaders, 'content-type': 'image/png' }, body: png })).status, 403);
  assert.equal(scanCount(),2);
  const download = await fetch(`${base}/api/attachments/file/${attachment.id}/content`, { headers: customerHeaders });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  assert.match(download.headers.get('content-disposition') ?? '', /filename\*=UTF-8''/);
},{ATTACHMENT_SCAN_MODE:'clamav',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:String(port),CLAMAV_TIMEOUT_MS:'500'})));

test('business notifications are committed once and failed deliveries can be retried', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const requestId=randomUUID();
  const orderResponse=await post('/api/orders',{requestId,warehouseId,lines:[{productId,quantity:1}]},customerHeaders);
  const order=await orderResponse.json();
  assert.equal((await post('/api/orders',{requestId,warehouseId,lines:[{productId,quantity:1}]},customerHeaders)).status,201);
  const notices=(await db.query("SELECT count(*)::int count,count(DISTINCT recipient_user_id)::int recipients FROM notification_outbox WHERE event_type='order_submitted' AND aggregate_id=$1",[order.id])).rows[0];
  assert.equal(notices.count>0,true);assert.equal(notices.count,notices.recipients);
  await post(`/api/admin/orders/${order.id}/confirm`,{requestId:randomUUID()},operatorHeaders);
  const reservationId=(await(await fetch(`${base}/api/warehouse/shipments/queue`,{headers:warehouseHeaders})).json()).find(item=>item.orderId===order.id).reservationId;
  await prepareShipment(post,order.id,reservationId,1,warehouseHeaders);
  const shipment=await(await post('/api/warehouse/shipments',{requestId:randomUUID(),lines:[{reservationId,quantity:1}]},warehouseHeaders)).json();
  const customerNotice=(await db.query("SELECT id FROM notification_outbox WHERE event_type='shipment_created' AND aggregate_id=$1",[shipment.id])).rows[0];
  assert(customerNotice);
  await db.query("UPDATE notification_outbox SET status='failed',attempts=4,next_attempt_at=now()+interval '1 day',last_error_code='delivery_failed' WHERE id=$1",[customerNotice.id]);
  assert.equal((await post(`/api/admin/notifications/${customerNotice.id}/retry`,{},operatorHeaders)).status,201);
  assert.deepEqual((await db.query('SELECT status,attempts,last_error_code FROM notification_outbox WHERE id=$1',[customerNotice.id])).rows[0],{status:'pending',attempts:0,last_error_code:null});
  assert.equal((await(await fetch(`${base}/api/admin/notifications`,{headers:operatorHeaders})).json()).some(item=>item.id===customerNotice.id),true);
  assert.deepEqual(await(await post('/api/admin/notifications/process',{},operatorHeaders)).json(),{processed:0});
}));

test('same approval request is replayed and concurrent approval cannot over-reserve', () => fixture(async ({ db, warehouseId, productId, customerHeaders, operatorHeaders, post }) => {
  const create = async () => (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 4 }] }, customerHeaders)).json();
  const first = await create(), second = await create();
  const requestId = randomUUID();
  const [firstAttempt, retry] = await Promise.all([
    post(`/api/admin/orders/${first.id}/confirm`, { requestId }, operatorHeaders),
    post(`/api/admin/orders/${first.id}/confirm`, { requestId }, operatorHeaders),
  ]);
  assert.deepEqual([firstAttempt.status, retry.status].sort(), [201, 201]);
  assert.deepEqual(await firstAttempt.json(), await retry.json());
  const secondConfirmation = await post(`/api/admin/orders/${second.id}/confirm`, { requestId: randomUUID() }, operatorHeaders);
  assert.equal(secondConfirmation.status, 201);
  const balance = (await db.query('SELECT reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0];
  assert.equal(balance.reserved_quantity, 5);
}));

test('administrator reallocates newly received stock to a waiting order exactly once', () => fixture(async ({ db, supplierId, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 8 }] }, customerHeaders)).json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  assert.equal((await post('/api/admin/receipts', { requestId: randomUUID(), supplierId, warehouseId, lines: [{ productId, quantity: 3 }] }, operatorHeaders)).status, 201);
  const requestId = randomUUID();
  const [first, replay] = await Promise.all([
    post(`/api/admin/orders/${order.id}/allocate`, { requestId }, operatorHeaders),
    post(`/api/admin/orders/${order.id}/allocate`, { requestId }, operatorHeaders),
  ]);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.deepEqual(await first.json(), await replay.json());
  assert.deepEqual((await db.query('SELECT requested_quantity,reserved_quantity FROM order_lines WHERE order_id=$1', [order.id])).rows[0], { requested_quantity: 8, reserved_quantity: 8 });
  assert.deepEqual((await db.query('SELECT quantity,shipped_quantity,status FROM reservations WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id=$1)', [order.id])).rows[0], { quantity: 8, shipped_quantity: 0, status: 'active' });
  assert.deepEqual((await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0], { on_hand_quantity: 8, reserved_quantity: 8 });
  const queueLine = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(line => line.orderId === order.id);
  assert.equal(queueLine.remainingQuantity, 8);
}));

test('concurrent waiting-order allocation cannot reserve the same receipt twice', () => fixture(async ({ db, supplierId, warehouseId, productId, customerHeaders, operatorHeaders, post }) => {
  const create = async () => (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 6 }] }, customerHeaders)).json();
  const firstOrder = await create(), secondOrder = await create();
  await post(`/api/admin/orders/${firstOrder.id}/confirm`, { requestId: randomUUID() }, operatorHeaders);
  await post(`/api/admin/orders/${secondOrder.id}/confirm`, { requestId: randomUUID() }, operatorHeaders);
  await post('/api/admin/receipts', { requestId: randomUUID(), supplierId, warehouseId, lines: [{ productId, quantity: 2 }] }, operatorHeaders);
  const results = await Promise.all([
    post(`/api/admin/orders/${firstOrder.id}/allocate`, { requestId: randomUUID() }, operatorHeaders),
    post(`/api/admin/orders/${secondOrder.id}/allocate`, { requestId: randomUUID() }, operatorHeaders),
  ]);
  assert.deepEqual(results.map(response => response.status), [201, 201]);
  const bodies = await Promise.all(results.map(response => response.json()));
  assert.equal(bodies.reduce((total, body) => total + body.allocatedQuantity, 0), 2);
  assert.equal((await db.query('SELECT reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0].reserved_quantity, 7);
  assert.equal((await db.query('SELECT sum(reserved_quantity)::int AS quantity FROM order_lines WHERE order_id=ANY($1::uuid[])', [[firstOrder.id, secondOrder.id]])).rows[0].quantity, 7);
}));

test('customer cancellation request pauses fulfillment until an administrator rejects it', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 8 }] }, customerHeaders)).json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const reservationId = (await db.query('SELECT r.id FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=$1', [order.id])).rows[0].id;
  const requestId = randomUUID();
  const body = { requestId, reason: '다음 행사 취소로 잔여 수량이 필요하지 않습니다.' };
  const [first, replay] = await Promise.all([
    post(`/api/orders/${order.id}/cancellation-requests`, body, customerHeaders),
    post(`/api/orders/${order.id}/cancellation-requests`, body, customerHeaders),
  ]);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  const request = await first.json();
  assert.deepEqual(request, await replay.json());
  assert.equal(request.status, 'submitted');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM order_cancellation_requests WHERE order_id=$1 AND status='submitted'", [order.id])).rows[0].n, 1);
  assert.equal((await post(`/api/orders/${order.id}/cancellation-requests`, { requestId: randomUUID(), reason: '중복 요청' }, customerHeaders)).status, 409);

  const pending = (await orderItems(await fetch(`${base}/api/admin/orders`, { headers: operatorHeaders }))).find(item => item.id === order.id);
  assert.equal(pending.cancellationRequest.id, request.id);
  assert.equal(pending.cancellationRequest.reason, body.reason);
  const queue = await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json();
  assert.equal(queue.some(item => item.orderId === order.id), false);
  assert.equal((await post(`/api/admin/orders/${order.id}/allocate`, { requestId: randomUUID() }, operatorHeaders)).status, 409);
  assert.equal((await post(`/api/admin/orders/${order.id}/cancel`, { requestId: randomUUID(), reason: '직접 취소 우회 시도' }, operatorHeaders)).status, 409);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 1 }] }, warehouseHeaders)).status, 409);
  assert.equal((await post(`/api/admin/order-cancellation-requests/${request.id}/reject`, { requestId: randomUUID() }, operatorHeaders)).status, 400);

  const rejected = await post(`/api/admin/order-cancellation-requests/${request.id}/reject`, { requestId: randomUUID(), reviewNote: '기입고 예약분이 확정되어 공급 가능합니다.' }, operatorHeaders);
  assert.equal(rejected.status, 201);
  assert.deepEqual(await rejected.json(), { id: request.id, orderId: order.id, status: 'rejected', reviewNote: '기입고 예약분이 확정되어 공급 가능합니다.' });
  const customerOrder = (await orderItems(await fetch(`${base}/api/orders`, { headers: customerHeaders }))).find(item => item.id === order.id);
  assert.equal(customerOrder.cancellationRequest.status, 'rejected');
  assert.equal(customerOrder.cancellationRequest.reviewNote, '기입고 예약분이 확정되어 공급 가능합니다.');
  const resumedQueue = await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json();
  assert.equal(resumedQueue.some(item => item.orderId === order.id), true);
  const pagedQueue = await (await fetch(`${base}/api/warehouse/shipments/queue?page=1&pageSize=50&query=${order.id}`, { headers: warehouseHeaders })).json();
  assert.equal(pagedQueue.total, 1);
  assert.equal(pagedQueue.items[0].orderId, order.id);
}));

test('administrator approval cancels only unshipped quantity and preserves shipped ledger', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 5 }] }, customerHeaders)).json();
  await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  await prepareShipment(post, order.id, reservationId, 4, warehouseHeaders);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 2 }] }, warehouseHeaders)).status, 201);
  const cancellation = await (await post(`/api/orders/${order.id}/cancellation-requests`, { requestId: randomUUID(), reason: '부분 출고 후 잔량 공급 중단 요청' }, customerHeaders)).json();
  assert.deepEqual((await db.query('SELECT picked_quantity,inspected_quantity FROM shipment_work_lines WHERE reservation_id=$1', [reservationId])).rows[0], { picked_quantity: 0, inspected_quantity: 0 });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM shipment_work_line_events WHERE reservation_id=$1 AND event_type='reset'", [reservationId])).rows[0].n, 1);
  const reviewRequestId = randomUUID();
  const [first, replay] = await Promise.all([
    post(`/api/admin/order-cancellation-requests/${cancellation.id}/approve`, { requestId: reviewRequestId }, operatorHeaders),
    post(`/api/admin/order-cancellation-requests/${cancellation.id}/approve`, { requestId: reviewRequestId }, operatorHeaders),
  ]);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  const approved = await first.json();
  assert.deepEqual(approved, await replay.json());
  assert.equal(approved.status, 'approved');
  assert.equal(approved.releasedQuantity, 3);
  assert.deepEqual((await db.query('SELECT status FROM orders WHERE id=$1', [order.id])).rows[0], { status: 'cancelled' });
  assert.deepEqual((await db.query('SELECT status,shipped_quantity FROM reservations WHERE id=$1', [reservationId])).rows[0], { status: 'released', shipped_quantity: 2 });
  assert.deepEqual((await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0], { on_hand_quantity: 3, reserved_quantity: 0 });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM receivable_entries re JOIN shipment_lines sl ON sl.id=re.shipment_line_id JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=$1 AND re.quantity=2 AND re.amount=20000", [order.id])).rows[0].n, 1);
  assert.deepEqual((await db.query('SELECT reason,cancelled_by FROM order_cancellations WHERE order_id=$1', [order.id])).rows[0], { reason: '부분 출고 후 잔량 공급 중단 요청', cancelled_by: approved.reviewedBy });
  const customerOrder = (await orderItems(await fetch(`${base}/api/orders`, { headers: customerHeaders }))).find(item => item.id === order.id);
  assert.equal(customerOrder.cancellationReason, '부분 출고 후 잔량 공급 중단 요청');
  assert.equal(customerOrder.cancellationRequest.status, 'approved');
  const filteredCustomer = await (await fetch(`${base}/api/orders?page=1&pageSize=50&status=cancelled&query=${order.id.slice(0,8)}`, { headers: customerHeaders })).json();
  assert.equal(filteredCustomer.total, 1);
  assert.equal(filteredCustomer.items[0].id, order.id);
  const historyOrder = (await orderItems(await fetch(`${base}/api/admin/orders/history`, { headers: operatorHeaders }))).find(item => item.id === order.id);
  assert.deepEqual(historyOrder.cancellationRequests.map(item => ({ status: item.status, reason: item.reason })), [{ status: 'approved', reason: '부분 출고 후 잔량 공급 중단 요청' }]);
  assert.match(historyOrder.cancellationRequests[0].reviewedBy, /^operator-/);
  assert.equal((await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).some(item => item.orderId === order.id), false);
}));

test('warehouse ships a reservation in parts without replaying stock movements', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const submitted = await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 5 }] }, customerHeaders);
  const order = await submitted.json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const confirmedOrders = await orderItems(await fetch(`${base}/api/admin/orders`, { headers: operatorHeaders }));
  const confirmedOrder = confirmedOrders.find(item => item.id === order.id);
  const filteredPending = await (await fetch(`${base}/api/admin/orders?page=1&pageSize=50&status=confirmed&query=${order.id.slice(0,8)}`, { headers: operatorHeaders })).json();
  assert.equal(filteredPending.total, 1);
  assert.deepEqual(confirmedOrder.lines.map(line => ({ requestedQuantity: line.requestedQuantity, reservedQuantity: line.reservedQuantity, shippedQuantity: line.shippedQuantity, remainingReservedQuantity: line.remainingReservedQuantity, waitingQuantity: line.waitingQuantity, unitPrice: line.unitPrice })), [{ requestedQuantity: 5, reservedQuantity: 5, shippedQuantity: 0, remainingReservedQuantity: 5, waitingQuantity: 0, unitPrice: '10000' }]);
  const queue = await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders });
  assert.equal(queue.status, 200);
  const queuedOrder = (await queue.json()).find(item => item.orderId === order.id);
  assert.equal(typeof queuedOrder.customerCode, 'string');
  assert.equal(Number.isNaN(Date.parse(queuedOrder.orderCreatedAt)), false);
  assert.equal(Number.isNaN(Date.parse(queuedOrder.confirmedAt)), false);
  const reservationId = queuedOrder.reservationId;
  await prepareShipment(post, order.id, reservationId, 5, warehouseHeaders);
  const requestId = randomUUID();
  const [first, replay] = await Promise.all([post('/api/warehouse/shipments', { requestId, lines: [{ reservationId, quantity: 2 }] }, warehouseHeaders), post('/api/warehouse/shipments', { requestId, lines: [{ reservationId, quantity: 2 }] }, warehouseHeaders)]);
  assert.equal(first.status, 201); assert.deepEqual(await first.json(), await replay.json());
  assert.deepEqual((await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0], { on_hand_quantity: 3, reserved_quantity: 3 });
  const partialOrder = (await orderItems(await fetch(`${base}/api/admin/orders`, { headers: operatorHeaders }))).find(item => item.id === order.id);
  assert.deepEqual(partialOrder.lines.map(line => ({ shippedQuantity: line.shippedQuantity, remainingReservedQuantity: line.remainingReservedQuantity, waitingQuantity: line.waitingQuantity })), [{ shippedQuantity: 2, remainingReservedQuantity: 3, waitingQuantity: 0 }]);
  const customerHistoryResponse = await fetch(`${base}/api/orders`, { headers: customerHeaders });
  assert.equal(customerHistoryResponse.status, 200);
  const customerOrder = (await orderItems(customerHistoryResponse)).find(item => item.id === order.id);
  const customerLine = customerOrder.lines[0];
  const warehouseLine = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id);
  assert.deepEqual(
    { customer: [customerLine.shippedQuantity, customerLine.remainingReservedQuantity, customerLine.waitingQuantity], admin: [partialOrder.lines[0].shippedQuantity, partialOrder.lines[0].remainingReservedQuantity, partialOrder.lines[0].waitingQuantity], warehouse: [2, warehouseLine.remainingQuantity, 0] },
    { customer: [2, 3, 0], admin: [2, 3, 0], warehouse: [2, 3, 0] },
  );
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 3 }] }, warehouseHeaders)).status, 201);
  assert.deepEqual((await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0], { on_hand_quantity: 0, reserved_quantity: 0 });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM inventory_movements WHERE movement_type='shipment' AND warehouse_id=$1 AND product_id=$2", [warehouseId, productId])).rows[0].n, 2);
  assert.deepEqual((await db.query('SELECT e.quantity,e.unit_price,e.amount FROM receivable_entries e JOIN shipment_lines sl ON sl.id=e.shipment_line_id JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=$1 ORDER BY e.created_at', [order.id])).rows, [{ quantity: 2, unit_price: '10000', amount: '20000' }, { quantity: 3, unit_price: '10000', amount: '30000' }]);
  const receivables = await fetch(`${base}/api/admin/receivables`, { headers: operatorHeaders });
  assert.equal(receivables.status, 200);
  const receivableRows = await receivables.json();
  assert.equal(receivableRows.filter(entry => entry.quantity === 2 && entry.amount === '20000').length, 1);
  assert.equal(receivableRows.filter(entry => entry.quantity === 3 && entry.amount === '30000').length, 1);
  const completedOrders = await orderItems(await fetch(`${base}/api/admin/orders`, { headers: operatorHeaders }));
  assert.equal(completedOrders.some(item => item.id === order.id), false);
  const adminHistoryResponse = await fetch(`${base}/api/admin/orders/history`, { headers: operatorHeaders });
  assert.equal(adminHistoryResponse.status, 200);
  const completedAdminOrder = (await orderItems(adminHistoryResponse)).find(item => item.id === order.id);
  assert.equal(completedAdminOrder.fulfillmentStatus, 'completed');
  assert.deepEqual(completedAdminOrder.shipments.map(shipment => ({ quantity: shipment.quantity, amount: shipment.amount, lines: shipment.lines.map(line => ({ quantity: line.quantity, amount: line.amount, hasLedgerId: typeof line.ledgerId === 'string' })) })), [
    { quantity: 2, amount: '20000', lines: [{ quantity: 2, amount: '20000', hasLedgerId: true }] },
    { quantity: 3, amount: '30000', lines: [{ quantity: 3, amount: '30000', hasLedgerId: true }] },
  ]);
  const completedCustomerOrder = (await orderItems(await fetch(`${base}/api/orders`, { headers: customerHeaders }))).find(item => item.id === order.id);
  assert.deepEqual(completedCustomerOrder.lines.map(line => ({ shippedQuantity: line.shippedQuantity, remainingReservedQuantity: line.remainingReservedQuantity, waitingQuantity: line.waitingQuantity })), [{ shippedQuantity: 5, remainingReservedQuantity: 0, waitingQuantity: 0 }]);
}));

test('taxable partial shipments use cumulative half-up tax without split rounding drift', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  await db.query("UPDATE customer_prices SET unit_price=3335,tax_category='taxable',tax_rate_bps=1000 WHERE customer_id=(SELECT customer_id FROM customer_prices WHERE product_id=$1) AND product_id=$1", [productId]);
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 2 }] }, customerHeaders)).json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  await prepareShipment(post, order.id, reservationId, 2, warehouseHeaders);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 1 }] }, warehouseHeaders)).status, 201);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 1 }] }, warehouseHeaders)).status, 201);
  assert.deepEqual((await db.query(`SELECT supply_amount,tax_amount,amount FROM receivable_entries e JOIN shipment_lines sl ON sl.id=e.shipment_line_id JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=$1 ORDER BY e.created_at,e.id`, [order.id])).rows, [
    { supply_amount: '3335', tax_amount: '334', amount: '3669' },
    { supply_amount: '3335', tax_amount: '333', amount: '3668' },
  ]);
  const firstShipmentLine = (await db.query('SELECT sl.id FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=$1 ORDER BY s.shipped_at,sl.id LIMIT 1',[order.id])).rows[0].id;
  assert.equal((await post('/api/returns',{requestId:randomUUID(),lines:[{shipmentLineId:firstShipmentLine,quantity:1,reason:'과세 반품'}]},customerHeaders)).status,201);
  const returnLine=(await(await fetch(`${base}/api/warehouse/returns/queue`,{headers:warehouseHeaders})).json())[0];
  assert.equal((await post(`/api/warehouse/returns/lines/${returnLine.returnLineId}/inspect`,{requestId:randomUUID(),receivedQuantity:1,normalQuantity:1,defectiveQuantity:0,defectiveReason:null},warehouseHeaders)).status,201);
  const inspectionId=(await db.query('SELECT id FROM return_inspections WHERE return_line_id=$1',[returnLine.returnLineId])).rows[0].id;
  assert.equal((await post(`/api/admin/returns/inspections/${inspectionId}/credit`,{requestId:randomUUID(),quantity:1},operatorHeaders)).status,201);
  assert.deepEqual((await db.query('SELECT supply_amount,tax_amount,amount FROM return_credits WHERE return_inspection_id=$1',[inspectionId])).rows[0],{supply_amount:'3335',tax_amount:'334',amount:'3669'});
}));

test('warehouse requires picking and inspection before partial shipment', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 5 }] }, customerHeaders)).json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/claim`, { requestId: randomUUID() }, warehouseHeaders)).status, 201);

  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 1 }] }, warehouseHeaders)).status, 409);
  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/pick`, { requestId: randomUUID(), lines: [{ reservationId, quantity: 6 }] }, warehouseHeaders)).status, 409);
  const pickRequestId = randomUUID();
  const picked = await post(`/api/warehouse/shipments/orders/${order.id}/pick`, { requestId: pickRequestId, lines: [{ reservationId, quantity: 4 }] }, warehouseHeaders);
  const pickedReplay = await post(`/api/warehouse/shipments/orders/${order.id}/pick`, { requestId: pickRequestId, lines: [{ reservationId, quantity: 4 }] }, warehouseHeaders);
  assert.equal(picked.status, 201);
  assert.deepEqual(await picked.json(), await pickedReplay.json());
  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/inspect`, { requestId: randomUUID(), lines: [{ reservationId, quantity: 5 }] }, warehouseHeaders)).status, 409);
  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/inspect`, { requestId: randomUUID(), lines: [{ reservationId, quantity: 3 }] }, warehouseHeaders)).status, 201);

  const ready = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id);
  assert.deepEqual({ picked: ready.pickedQuantity, inspected: ready.inspectedQuantity, shippable: ready.shippableQuantity }, { picked: 4, inspected: 3, shippable: 3 });
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 4 }] }, warehouseHeaders)).status, 409);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 2 }] }, warehouseHeaders)).status, 201);
  assert.deepEqual((await db.query('SELECT picked_quantity,inspected_quantity FROM shipment_work_lines WHERE reservation_id=$1', [reservationId])).rows[0], { picked_quantity: 2, inspected_quantity: 1 });
}));

test('warehouse records delivery tracking and exposes it to customer and administrator', () => fixture(async ({ db, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const order=await(await post('/api/orders',{requestId:randomUUID(),warehouseId,lines:[{productId,quantity:2}]},customerHeaders)).json();await post(`/api/admin/orders/${order.id}/confirm`,{requestId:randomUUID()},operatorHeaders);const reservationId=(await db.query('SELECT r.id FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=$1',[order.id])).rows[0].id;await prepareShipment(post,order.id,reservationId,2,warehouseHeaders);const shipment=await(await post('/api/warehouse/shipments',{requestId:randomUUID(),lines:[{reservationId,quantity:2}]},warehouseHeaders)).json();
  assert.equal((await post(`/api/warehouse/deliveries/${shipment.id}/dispatch`,{requestId:randomUUID()},warehouseHeaders)).status,409);
  assert.equal((await post(`/api/warehouse/deliveries/${shipment.id}/schedule`,{requestId:randomUUID(),scheduledDate:'2026-09-10',carrierName:'테스트택배',trackingNumber:'T-100'},warehouseHeaders)).status,201);
  assert.equal((await post(`/api/warehouse/deliveries/${shipment.id}/dispatch`,{requestId:randomUUID()},warehouseHeaders)).status,201);
  assert.equal((await post(`/api/warehouse/deliveries/${shipment.id}/deliver`,{requestId:randomUUID(),recipientName:'김수령',proofMethod:'staff_confirmation',proofNote:'매장 카운터 인계'},warehouseHeaders)).status,201);
  assert.equal((await post(`/api/warehouse/deliveries/${shipment.id}/fail`,{requestId:randomUUID(),reason:'뒤늦은 상태 변경'},warehouseHeaders)).status,409);
  assert.deepEqual((await db.query('SELECT status,recipient_name,proof_note FROM shipment_deliveries WHERE shipment_id=$1',[shipment.id])).rows[0],{status:'delivered',recipient_name:'김수령',proof_note:'매장 카운터 인계'});
  const customerOrder=(await(await fetch(`${base}/api/orders?query=${order.id}`,{headers:customerHeaders})).json()).items[0];
  assert.deepEqual(customerOrder.shipments.map(item=>({deliveryStatus:item.deliveryStatus,trackingNumber:item.trackingNumber,recipientName:item.recipientName})),[{deliveryStatus:'delivered',trackingNumber:'T-100',recipientName:'김수령'}]);
  const adminOrder=(await(await fetch(`${base}/api/admin/orders/history?query=${order.id}`,{headers:operatorHeaders})).json()).items[0];
  assert.deepEqual(adminOrder.shipments.map(item=>({deliveryStatus:item.deliveryStatus,trackingNumber:item.trackingNumber,proofNote:item.proofNote})),[{deliveryStatus:'delivered',trackingNumber:'T-100',proofNote:'매장 카운터 인계'}]);
}));

test('stock count holds SKU movement and releases newest reservations when physical stock is short', () => fixture(async ({ db, warehouseId, productId, supplierId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const first=await(await post('/api/orders',{requestId:randomUUID(),warehouseId,lines:[{productId,quantity:3}]},customerHeaders)).json();
  await post(`/api/admin/orders/${first.id}/confirm`,{requestId:randomUUID()},operatorHeaders);
  const second=await(await post('/api/orders',{requestId:randomUUID(),warehouseId,lines:[{productId,quantity:4}]},customerHeaders)).json();
  await post(`/api/admin/orders/${second.id}/confirm`,{requestId:randomUUID()},operatorHeaders);
  const before=(await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2',[warehouseId,productId])).rows[0];
  const started=await post('/api/admin/stock-counts',{requestId:randomUUID(),warehouseId,productId,reason:'월말 정기 실사'},operatorHeaders);
  assert.equal(started.status,201);const count=await started.json();
  assert.equal((await post('/api/admin/stock-counts',{requestId:randomUUID(),warehouseId,productId,reason:'중복 실사'},operatorHeaders)).status,409);
  assert.equal((await post('/api/admin/inventory/adjustments',{requestId:randomUUID(),warehouseId,productId,quantityDelta:1,reason:'보류 중 정정'},operatorHeaders)).status,409);
  assert.equal((await post('/api/admin/receipts',{requestId:randomUUID(),supplierId,warehouseId,lines:[{productId,quantity:1}]},operatorHeaders)).status,409);
  assert.equal((await post('/api/admin/orders/'+first.id+'/allocate',{requestId:randomUUID()},operatorHeaders)).status,409);
  assert.equal((await post(`/api/warehouse/shipments/orders/${first.id}/claim`,{requestId:randomUUID()},warehouseHeaders)).status,409);
  const cancellation=await(await post(`/api/orders/${first.id}/cancellation-requests`,{requestId:randomUUID(),reason:'실사 중 취소 요청'},customerHeaders)).json();
  assert.equal((await post(`/api/admin/order-cancellation-requests/${cancellation.id}/approve`,{requestId:randomUUID()},operatorHeaders)).status,409);
  const catalog=await(await fetch(`${base}/api/orders/catalog`,{headers:customerHeaders})).json();assert.equal(catalog.products.some(item=>item.id===productId),false);
  const finalized=await post(`/api/admin/stock-counts/${count.id}/finalize`,{requestId:randomUUID(),countedQuantity:before.reserved_quantity-2,reason:'실측 부족 2개 확인'},operatorHeaders);
  assert.equal(finalized.status,201);assert.equal((await finalized.json()).releasedReservationQuantity,2);
  const after=(await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2',[warehouseId,productId])).rows[0];
  assert.equal(after.on_hand_quantity,before.reserved_quantity-2);assert.equal(after.reserved_quantity,before.reserved_quantity-2);
  const rows=(await db.query(`SELECT l.order_id,l.reserved_quantity,r.status,r.quantity-r.shipped_quantity remaining
    FROM order_lines l JOIN reservations r ON r.order_line_id=l.id WHERE l.order_id=ANY($1::uuid[]) ORDER BY l.order_id`,[[first.id,second.id]])).rows;
  const firstRow=rows.find(row=>row.order_id===first.id),secondRow=rows.find(row=>row.order_id===second.id);
  assert.equal(firstRow.reserved_quantity,3);assert.equal(secondRow.reserved_quantity,0);assert.equal(secondRow.status,'released');assert.equal(secondRow.remaining,2);
}));

test('warehouse work ownership blocks competing workers and closes after fulfillment', () => fixture(async ({ db, warehouseUserId, warehouseUser2Id, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, warehouseHeaders2, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 5 }] }, customerHeaders)).json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;

  const claimRequestId = randomUUID();
  const claimed = await post(`/api/warehouse/shipments/orders/${order.id}/claim`, { requestId: claimRequestId }, warehouseHeaders);
  assert.equal(claimed.status, 201);
  assert.deepEqual(await claimed.json(), { orderId: order.id, assignedTo: warehouseUserId, status: 'assigned' });
  const replay = await post(`/api/warehouse/shipments/orders/${order.id}/claim`, { requestId: claimRequestId }, warehouseHeaders);
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), { orderId: order.id, assignedTo: warehouseUserId, status: 'assigned' });

  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/claim`, { requestId: randomUUID() }, warehouseHeaders2)).status, 409);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 1 }] }, warehouseHeaders2)).status, 409);
  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/pick`, { requestId: randomUUID(), lines: [{ reservationId, quantity: 3 }] }, warehouseHeaders)).status, 201);
  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/inspect`, { requestId: randomUUID(), lines: [{ reservationId, quantity: 2 }] }, warehouseHeaders)).status, 201);
  const queueForOwner = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id);
  const queueForOther = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders2 })).json()).find(item => item.orderId === order.id);
  assert.deepEqual({ assignedTo: queueForOwner.assignedTo, assignmentMine: queueForOwner.assignmentMine }, { assignedTo: warehouseUserId, assignmentMine: true });
  assert.deepEqual({ assignedTo: queueForOther.assignedTo, assignmentMine: queueForOther.assignmentMine }, { assignedTo: warehouseUserId, assignmentMine: false });

  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/release`, { requestId: randomUUID(), reason: '' }, warehouseHeaders)).status, 400);
  const released = await post(`/api/warehouse/shipments/orders/${order.id}/release`, { requestId: randomUUID(), reason: '교대 근무자에게 잔여 출고 작업을 인계합니다.' }, warehouseHeaders);
  assert.equal(released.status, 201);
  assert.deepEqual(await released.json(), { orderId: order.id, releasedBy: warehouseUserId, status: 'released' });

  assert.equal((await post(`/api/warehouse/shipments/orders/${order.id}/claim`, { requestId: randomUUID() }, warehouseHeaders2)).status, 201);
  const handedOver = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders2 })).json()).find(item => item.orderId === order.id);
  assert.deepEqual({ picked: handedOver.pickedQuantity, inspected: handedOver.inspectedQuantity }, { picked: 3, inspected: 2 });
  await prepareShipment(post, order.id, reservationId, 5, warehouseHeaders2);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 5 }] }, warehouseHeaders2)).status, 201);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM shipment_work_assignments WHERE order_id=$1', [order.id])).rows[0].n, 0);
  assert.deepEqual((await db.query('SELECT event_type,actor_id,assignee_id FROM shipment_work_assignment_events WHERE order_id=$1 ORDER BY created_at,id', [order.id])).rows.map(row => [row.event_type, row.actor_id, row.assignee_id]), [
    ['claimed', warehouseUserId, warehouseUserId],
    ['released', warehouseUserId, warehouseUserId],
    ['claimed', warehouseUser2Id, warehouseUser2Id],
    ['completed', warehouseUser2Id, warehouseUser2Id],
  ]);
}));

test('administrator cancels only the unshipped reservation balance', () => fixture(async ({ db, operatorId, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 5 }] }, customerHeaders)).json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  await prepareShipment(post, order.id, reservationId, 2, warehouseHeaders);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 2 }] }, warehouseHeaders)).status, 201);
  const requestId = randomUUID();
  const [first, replay] = await Promise.all([post(`/api/admin/orders/${order.id}/cancel`, { requestId, reason: 'customer cancellation' }, operatorHeaders), post(`/api/admin/orders/${order.id}/cancel`, { requestId, reason: 'customer cancellation' }, operatorHeaders)]);
  assert.equal(first.status, 201); assert.equal(replay.status, 201); assert.deepEqual(await first.json(), await replay.json());
  assert.deepEqual((await db.query('SELECT status FROM orders WHERE id=$1', [order.id])).rows[0], { status: 'cancelled' });
  assert.deepEqual((await db.query('SELECT reason,cancelled_by FROM order_cancellations WHERE order_id=$1', [order.id])).rows[0], { reason: 'customer cancellation', cancelled_by: operatorId });
  assert.deepEqual((await db.query('SELECT status,shipped_quantity FROM reservations WHERE id=$1', [reservationId])).rows[0], { status: 'released', shipped_quantity: 2 });
  assert.deepEqual((await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0], { on_hand_quantity: 3, reserved_quantity: 0 });
  const historyResponse = await fetch(`${base}/api/admin/orders/history`, { headers: operatorHeaders });
  assert.equal(historyResponse.status, 200);
  const cancelledOrder = (await orderItems(historyResponse)).find(item => item.id === order.id);
  assert.equal(cancelledOrder.fulfillmentStatus, 'cancelled');
  assert.equal(cancelledOrder.cancellationReason, 'customer cancellation');
  assert.equal(Number.isNaN(Date.parse(cancelledOrder.cancelledAt)), false);
  assert.equal(cancelledOrder.shipments.length, 1);
  const customerOrder = (await orderItems(await fetch(`${base}/api/orders`, { headers: customerHeaders }))).find(item => item.id === order.id);
  assert.equal(customerOrder.cancellationReason, 'customer cancellation');
  assert.equal(Number.isNaN(Date.parse(customerOrder.cancelledAt)), false);
}));

test('administrator records an auditable inventory adjustment without reducing below reservations', () => fixture(async ({ db, warehouseId, productId, base, operatorHeaders, post }) => {
  const requestId = randomUUID();
  const [first, replay] = await Promise.all([post('/api/admin/inventory/adjustments', { requestId, warehouseId, productId, quantityDelta: -2, reason: 'damaged stock' }, operatorHeaders), post('/api/admin/inventory/adjustments', { requestId, warehouseId, productId, quantityDelta: -2, reason: 'damaged stock' }, operatorHeaders)]);
  assert.equal(first.status, 201); assert.deepEqual(await first.json(), await replay.json());
  assert.deepEqual((await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0], { on_hand_quantity: 3, reserved_quantity: 0 });
  assert.equal((await post('/api/admin/inventory/adjustments', { requestId: randomUUID(), warehouseId, productId, quantityDelta: -4, reason: 'invalid reduction' }, operatorHeaders)).status, 409);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM inventory_movements WHERE movement_type='adjustment' AND warehouse_id=$1 AND product_id=$2", [warehouseId, productId])).rows[0].n, 1);
  const sku = (await db.query('SELECT sku FROM products WHERE id=$1', [productId])).rows[0].sku;
  const inventoryPage = await (await fetch(`${base}/api/admin/inventory?page=1&pageSize=50&query=${sku}`, { headers: operatorHeaders })).json();
  assert.equal(inventoryPage.total, 1);
  assert.equal(inventoryPage.items[0].productId, productId);
}));

test('administrator receipt replay records inventory only once', () => fixture(async ({ db, supplierId, warehouseId, productId, operatorHeaders, post }) => {
  const requestId = randomUUID();
  const body = { requestId, supplierId, warehouseId, lines: [{ productId, quantity: 2 }] };
  const [first, replay] = await Promise.all([post('/api/admin/receipts', body, operatorHeaders), post('/api/admin/receipts', body, operatorHeaders)]);
  assert.equal(first.status, 201); assert.equal(replay.status, 201); assert.deepEqual(await first.json(), await replay.json());
  assert.equal((await db.query('SELECT on_hand_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0].on_hand_quantity, 7);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM receipts WHERE supplier_id=$1 AND warehouse_id=$2', [supplierId, warehouseId])).rows[0].n, 1);
}));

test('administrator updates catalog records and can deactivate an individual customer price', () => fixture(async ({ db, customerId, productId, base, operatorHeaders, post }) => {
  assert.equal((await post(`/api/admin/catalog/customers/${customerId}`, { name: 'Renamed customer', paymentDueDay: 25 }, operatorHeaders)).status, 201);
  assert.equal((await post(`/api/admin/catalog/products/${productId}`, { name: 'Renamed product', saleUnit: 'each' }, operatorHeaders)).status, 201);
  assert.equal((await post('/api/admin/catalog/customer-prices', { customerId, productId, unitPrice: 12000, taxCategory: 'taxable', taxRateBps: 1000 }, operatorHeaders)).status, 201);
  assert.equal((await post('/api/admin/catalog/customer-prices/deactivate', { customerId, productId }, operatorHeaders)).status, 201);
  assert.deepEqual((await db.query('SELECT name,payment_due_day FROM customers WHERE id=$1', [customerId])).rows[0], { name: 'Renamed customer', payment_due_day: 25 });
  assert.deepEqual((await db.query('SELECT name,sale_unit FROM products WHERE id=$1', [productId])).rows[0], { name: 'Renamed product', sale_unit: 'each' });
  assert.equal((await db.query('SELECT active FROM customer_prices WHERE customer_id=$1 AND product_id=$2', [customerId, productId])).rows[0].active, false);
  const prices = await fetch(`${base}/api/admin/catalog/customer-prices?customerId=${customerId}`, { headers: operatorHeaders });
  assert.equal(prices.status, 200);
  assert.deepEqual((await prices.json()).map(item => ({ customerId: item.customerId, productId: item.productId, taxCategory: item.taxCategory, taxRateBps: item.taxRateBps, active: item.active })), [{ customerId, productId, taxCategory: 'taxable', taxRateBps: 1000, active: false }]);
}));

test('administrator dashboard summarizes actionable operations', () => fixture(async ({ base, customerHeaders, operatorHeaders, warehouseHeaders, warehouseId, productId, post }) => {
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 2 }] }, customerHeaders)).json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  await prepareShipment(post, order.id, reservationId, 2, warehouseHeaders);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 2 }] }, warehouseHeaders)).status, 201);
  const response = await fetch(`${base}/api/admin/dashboard?days=30`, { headers: operatorHeaders });
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.days, 30);
  assert.match(dashboard.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(dashboard.period).sort(), ['grossSalesAmount', 'netSalesAmount', 'orders', 'returnDeductionAmount', 'shipments']);
  assert.deepEqual(Object.keys(dashboard.orderStatus).sort(), ['confirmed', 'rejected', 'submitted']);
  assert.deepEqual(Object.keys(dashboard.fulfillment).sort(), ['rate', 'requestedQuantity', 'shippedQuantity']);
  assert.deepEqual(Object.keys(dashboard.inventory).sort(), ['availableQuantity', 'onHandQuantity', 'reservationRate', 'reservedQuantity']);
  assert.deepEqual(Object.keys(dashboard.settlement).sort(), ['billedAmount', 'collectedAmount', 'collectionRate', 'outstandingAmount']);
  assert(dashboard.period.orders >= 1);
  assert(dashboard.period.shipments >= 1);
  assert(Number(dashboard.period.grossSalesAmount) >= 20000);
  assert(dashboard.orderStatus.confirmed >= 1);
  assert(dashboard.fulfillment.shippedQuantity >= 2);
  assert.equal(typeof dashboard.pendingOrders, 'number');
  assert.equal(typeof dashboard.lowStockProducts, 'number');
  assert.equal(typeof dashboard.pendingReturns, 'number');
  assert.equal(typeof dashboard.unallocatedPaymentAmount, 'string');
  assert.equal(dashboard.daily.length, 30);
  assert.match(dashboard.daily[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof dashboard.daily.at(-1).orders, 'number');
  assert.equal(typeof dashboard.daily.at(-1).netSalesAmount, 'string');
  assert(Array.isArray(dashboard.topProducts));
  assert(dashboard.topProducts.some(item => item.shippedQuantity >= 2));
  assert(Array.isArray(dashboard.inventoryByWarehouse));
  assert(dashboard.inventoryByWarehouse.some(item => item.warehouseCode));
  assert(Array.isArray(dashboard.lowStockProductsList));
  assert(Array.isArray(dashboard.returnReasons));
  assert(Array.isArray(dashboard.monthlyFinance));
  assert.equal(dashboard.monthlyFinance.length, 6);
  assert(Array.isArray(dashboard.topDebtors));
  const warehouseAnalyticsResponse = await fetch(`${base}/api/warehouse/analytics?days=30`, { headers: warehouseHeaders });
  assert.equal(warehouseAnalyticsResponse.status, 200);
  const warehouseAnalytics = await warehouseAnalyticsResponse.json();
  assert.equal(warehouseAnalytics.daily.length, 30);
  assert(Array.isArray(warehouseAnalytics.agingBuckets));
  assert(Array.isArray(warehouseAnalytics.customers));
  assert(Array.isArray(warehouseAnalytics.returns));
  const customerAnalyticsResponse = await fetch(`${base}/api/analytics?days=30`, { headers: customerHeaders });
  assert.equal(customerAnalyticsResponse.status, 200);
  const customerAnalytics = await customerAnalyticsResponse.json();
  assert.equal(customerAnalytics.daily.length, 30);
  assert(Array.isArray(customerAnalytics.productSpend));
  assert(Array.isArray(customerAnalytics.monthlyFinance));
  assert.equal((await fetch(`${base}/api/admin/dashboard?days=14`, { headers: operatorHeaders })).status, 400);
  assert.equal((await fetch(`${base}/api/warehouse/analytics?days=14`, { headers: warehouseHeaders })).status, 400);
}));

test('customer requests a shipped item return and warehouse inspection restores only normal quantity', () => fixture(async ({ db, customerId, warehouseId, supplierId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  const submitted = await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 5 }] }, customerHeaders);
  const order = await submitted.json();
  assert.equal((await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders)).status, 201);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  await prepareShipment(post, order.id, reservationId, 5, warehouseHeaders);
  assert.equal((await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 5 }] }, warehouseHeaders)).status, 201);

  const shipmentLines = await fetch(`${base}/api/returns/shipment-lines`, { headers: customerHeaders });
  assert.equal(shipmentLines.status, 200);
  const shipmentLineId = (await shipmentLines.json())[0].shipmentLineId;
  const requestId = randomUUID();
  const requestBody = { requestId, lines: [{ shipmentLineId, quantity: 4, reason: 'Damaged after delivery' }] };
  const [firstRequest, replay] = await Promise.all([post('/api/returns', requestBody, customerHeaders), post('/api/returns', requestBody, customerHeaders)]);
  assert.equal(firstRequest.status, 201);
  assert.deepEqual(await firstRequest.json(), await replay.json());
  assert.equal((await post('/api/returns', { requestId: randomUUID(), lines: [{ shipmentLineId, quantity: 2, reason: 'Over shipped request' }] }, customerHeaders)).status, 409);

  const queue = await fetch(`${base}/api/warehouse/returns/queue`, { headers: warehouseHeaders });
  assert.equal(queue.status, 200);
  const queued = (await queue.json())[0];
  const pagedReturns = await (await fetch(`${base}/api/warehouse/returns/queue?page=1&pageSize=50&query=${queued.returnId}`, { headers: warehouseHeaders })).json();
  assert.equal(pagedReturns.total, 1);
  assert.equal(pagedReturns.items[0].returnLineId, queued.returnLineId);
  const inspection = await post(`/api/warehouse/returns/lines/${queued.returnLineId}/inspect`, { requestId: randomUUID(), receivedQuantity: 4, normalQuantity: 3, defectiveQuantity: 1, defectiveReason: 'Cracked packaging' }, warehouseHeaders);
  assert.equal(inspection.status, 201);
  assert.deepEqual(await inspection.json(), { returnLineId: queued.returnLineId, status: 'inspected', receivedQuantity: 4, normalQuantity: 3, defectiveQuantity: 1 });
  assert.deepEqual((await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])).rows[0], { on_hand_quantity: 3, reserved_quantity: 0 });
  assert.deepEqual((await db.query('SELECT requested_quantity,received_quantity,normal_quantity,defective_quantity FROM return_lines WHERE id=$1', [queued.returnLineId])).rows[0], { requested_quantity: 4, received_quantity: 4, normal_quantity: 3, defective_quantity: 1 });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM inventory_movements WHERE movement_type='return' AND return_inspection_id IS NOT NULL AND warehouse_id=$1 AND product_id=$2", [warehouseId, productId])).rows[0].n, 1);
  const creditRequestId = randomUUID();
  const inspectionId = (await db.query('SELECT id FROM return_inspections WHERE return_line_id=$1', [queued.returnLineId])).rows[0].id;
  const defect = await post(`/api/admin/returns/inspections/${inspectionId}/defects`, { requestId: randomUUID(), quantity: 1, disposition: 'quarantine', reason: 'quality review pending' }, operatorHeaders);
  assert.equal(defect.status, 201);
  assert.deepEqual((await defect.json()), { inspectionId, quantity: 1, disposition: 'quarantine' });
  assert.equal((await db.query('SELECT disposition FROM return_defect_dispositions WHERE return_inspection_id=$1', [inspectionId])).rows[0].disposition, 'quarantine');
  const dispositionId=(await db.query('SELECT id FROM return_defect_dispositions WHERE return_inspection_id=$1',[inspectionId])).rows[0].id;
  const resolutionRequestId=randomUUID();
  const [resolved,resolutionReplay]=await Promise.all([
    post(`/api/admin/returns/defects/${dispositionId}/resolve`,{requestId:resolutionRequestId,quantity:1,resolution:'supplier_return',supplierId,reference:'SUP-RETURN-1',reason:'공급처 반송 인계'},operatorHeaders),
    post(`/api/admin/returns/defects/${dispositionId}/resolve`,{requestId:resolutionRequestId,quantity:1,resolution:'supplier_return',supplierId,reference:'SUP-RETURN-1',reason:'공급처 반송 인계'},operatorHeaders),
  ]);
  assert.equal(resolved.status,201);assert.deepEqual(await resolved.json(),await resolutionReplay.json());
  const pendingCredits = await fetch(`${base}/api/admin/returns/credits/pending`, { headers: operatorHeaders });
  assert.equal(pendingCredits.status, 200);
  assert.equal((await pendingCredits.json()).find(item => item.inspectionId === inspectionId).originalUnitPrice, '10000');
  const creditPageResponse = await fetch(`${base}/api/admin/returns/credits/pending?page=1&pageSize=50&query=${queued.sku}`, { headers: operatorHeaders });
  assert.equal(creditPageResponse.status, 200);
  const creditPage = await creditPageResponse.json();
  assert.equal(creditPage.total, 1);
  assert.equal(creditPage.items[0].inspectionId, inspectionId);
  const [credit, creditReplay] = await Promise.all([post(`/api/admin/returns/inspections/${inspectionId}/credit`, { requestId: creditRequestId, quantity: 3 }, operatorHeaders), post(`/api/admin/returns/inspections/${inspectionId}/credit`, { requestId: creditRequestId, quantity: 3 }, operatorHeaders)]);
  assert.equal(credit.status, 201); assert.deepEqual(await credit.json(), await creditReplay.json());
  assert.deepEqual((await db.query('SELECT credited_quantity,unit_price,amount FROM return_credits WHERE return_line_id=$1', [queued.returnLineId])).rows[0], { credited_quantity: 3, unit_price: '10000', amount: '30000' });
  assert.equal((await db.query("SELECT amount FROM receivable_entries WHERE entry_type='return_credit' AND customer_id=$1", [customerId])).rows[0].amount, '-30000');
  const creditId=(await db.query('SELECT id FROM return_credits WHERE return_line_id=$1',[queued.returnLineId])).rows[0].id;
  const creditRefund=await post('/api/admin/refunds',{requestId:randomUUID(),sourceType:'return_credit',sourceId:creditId,refundDate:'2026-09-09',amount:10000,method:'bank_transfer',reference:'CREDIT-REFUND-1',reason:'반품 차감액 현금 환불'},operatorHeaders);
  assert.equal(creditRefund.status,201);
  assert.equal((await db.query("SELECT amount FROM receivable_entries WHERE entry_type='refund' AND customer_id=$1",[customerId])).rows[0].amount,'10000');
  const ledger = await fetch(`${base}/api/admin/receivables`, { headers: operatorHeaders });
  const ledgerItems=await ledger.json();assert.equal(ledgerItems.some(entry => entry.entryType === 'return_credit' && entry.amount === '-30000'), true);assert.equal(ledgerItems.some(entry=>entry.entryType==='refund'&&entry.amount==='10000'),true);
}));

test('settlement draft fixes one customer month ledger once and can be finalized', () => fixture(async ({ db, customerId, warehouseId, productId, base, customerHeaders, operatorHeaders, warehouseHeaders, post }) => {
  await db.query('UPDATE customers SET payment_due_day=31 WHERE id=$1', [customerId]);
  const order = await (await post('/api/orders', { requestId: randomUUID(), warehouseId, lines: [{ productId, quantity: 5 }] }, customerHeaders)).json();
  await post(`/api/admin/orders/${order.id}/confirm`, { requestId: randomUUID() }, operatorHeaders);
  const reservationId = (await (await fetch(`${base}/api/warehouse/shipments/queue`, { headers: warehouseHeaders })).json()).find(item => item.orderId === order.id).reservationId;
  await prepareShipment(post, order.id, reservationId, 5, warehouseHeaders);
  await post('/api/warehouse/shipments', { requestId: randomUUID(), lines: [{ reservationId, quantity: 5 }] }, warehouseHeaders);
  const period = (await db.query("SELECT to_char(CURRENT_DATE,'YYYY-MM') AS period")).rows[0].period;
  const [first, replay] = await Promise.all([post('/api/admin/settlements', { requestId: randomUUID(), customerId, period }, operatorHeaders), post('/api/admin/settlements', { requestId: randomUUID(), customerId, period }, operatorHeaders)]);
  assert.equal(first.status, 201); assert.equal(replay.status, 409);
  const draft = await first.json(); assert.equal(draft.status, 'draft'); assert.equal(draft.totalAmount, '50000');
  assert.deepEqual(await (await fetch(`${base}/api/settlements`, { headers: customerHeaders })).json(), []);
  assert.equal((await fetch(`${base}/api/settlements/${draft.id}`, { headers: customerHeaders })).status, 404);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM settlement_lines WHERE settlement_id=$1', [draft.id])).rows[0].n, 1);
  const settlements = await fetch(`${base}/api/admin/settlements?customerId=${customerId}&period=${period}`, { headers: operatorHeaders });
  assert.equal(settlements.status, 200);
  assert.deepEqual((await settlements.json()).map(item => ({ id: item.id, totalAmount: item.totalAmount, allocatedAmount: item.allocatedAmount })), [{ id: draft.id, totalAmount: '50000', allocatedAmount: '0' }]);
  const finalized = await post(`/api/admin/settlements/${draft.id}/finalize`, { requestId: randomUUID() }, operatorHeaders);
  const finalizedBody = await finalized.json();
  assert.equal(finalized.status, 201); assert.equal(finalizedBody.status, 'finalized');
  const expectedDueDate = (await db.query("SELECT to_char((date_trunc('month',$1::date)+interval '2 months - 1 day')::date,'YYYY-MM-DD') AS day", [`${period}-01`])).rows[0].day;
  assert.equal(finalizedBody.dueDate, expectedDueDate);
  const statement = await (await fetch(`${base}/api/admin/settlements/${draft.id}`, { headers: operatorHeaders })).json();
  assert.deepEqual({ supplyAmount: statement.supplyAmount, taxAmount: statement.taxAmount, totalAmount: statement.totalAmount, dueDate: statement.dueDate }, { supplyAmount: '50000', taxAmount: '0', totalAmount: '50000', dueDate: expectedDueDate });
  const customerStatementResponse = await fetch(`${base}/api/settlements/${draft.id}`, { headers: customerHeaders });
  assert.equal(customerStatementResponse.status, 200);
  assert.equal((await customerStatementResponse.json()).totalAmount, '50000');
  assert.equal((await post(`/api/admin/settlements/${draft.id}/finalize`, { requestId: randomUUID() }, operatorHeaders)).status, 409);
  const shippedLineId = (await db.query('SELECT id FROM shipment_lines WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=$1)', [order.id])).rows[0].id;
  assert.equal((await post('/api/returns', { requestId: randomUUID(), lines: [{ shipmentLineId: shippedLineId, quantity: 1, reason: 'post-close return' }] }, customerHeaders)).status, 201);
  const returnLine = (await (await fetch(`${base}/api/warehouse/returns/queue`, { headers: warehouseHeaders })).json())[0];
  assert.equal((await post(`/api/warehouse/returns/lines/${returnLine.returnLineId}/inspect`, { requestId: randomUUID(), receivedQuantity: 1, normalQuantity: 1, defectiveQuantity: 0, defectiveReason: null }, warehouseHeaders)).status, 201);
  const inspectionId = (await db.query('SELECT id FROM return_inspections WHERE return_line_id=$1', [returnLine.returnLineId])).rows[0].id;
  assert.equal((await post(`/api/admin/returns/inspections/${inspectionId}/credit`, { requestId: randomUUID(), quantity: 1 }, operatorHeaders)).status, 201);
  const nextMonth = (await db.query("SELECT to_char((date_trunc('month',CURRENT_DATE)+interval '1 month')::date,'YYYY-MM-DD') AS day")).rows[0].day;
  assert.equal((await db.query("SELECT to_char(business_date,'YYYY-MM-DD') AS day FROM receivable_entries WHERE entry_type='return_credit' AND customer_id=$1", [customerId])).rows[0].day, nextMonth);
  const paymentRequestId = randomUUID();
  const [payment, paymentReplay] = await Promise.all([
    post('/api/admin/payments', { requestId: paymentRequestId, customerId, paymentDate: `${period}-06`, amount: 40000, reference: 'bank-transfer-1' }, operatorHeaders),
    post('/api/admin/payments', { requestId: paymentRequestId, customerId, paymentDate: `${period}-06`, amount: 40000, reference: 'bank-transfer-1' }, operatorHeaders),
  ]);
  assert.equal(payment.status, 201); assert.equal(paymentReplay.status, 201);
  const paymentBody = await payment.json(); assert.deepEqual(paymentBody, await paymentReplay.json());
  assert.equal((await db.query("SELECT count(*)::int AS n FROM payments WHERE reference='bank-transfer-1' AND customer_id=$1", [customerId])).rows[0].n, 1);
  const allocationRequestId = randomUUID();
  const [allocation, allocationReplay] = await Promise.all([
    post(`/api/admin/payments/${paymentBody.id}/allocations`, { requestId: allocationRequestId, settlementId: draft.id, amount: 40000 }, operatorHeaders),
    post(`/api/admin/payments/${paymentBody.id}/allocations`, { requestId: allocationRequestId, settlementId: draft.id, amount: 40000 }, operatorHeaders),
  ]);
  assert.equal(allocation.status, 201); assert.equal(allocationReplay.status, 201); assert.deepEqual(await allocation.json(), await allocationReplay.json());
  assert.equal((await post(`/api/admin/payments/${paymentBody.id}/allocations`, { requestId: randomUUID(), settlementId: draft.id, amount: 1 }, operatorHeaders)).status, 409);
  assert.equal((await post(`/api/admin/payments/${paymentBody.id}/void`, { requestId: randomUUID(), reason: 'bank reversal' }, operatorHeaders)).status, 201);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_allocation_reversals WHERE payment_allocation_id IN (SELECT id FROM payment_allocations WHERE payment_id=$1)', [paymentBody.id])).rows[0].n, 1);
  const voidedPayments = await fetch(`${base}/api/admin/payments`, { headers: operatorHeaders });
  assert.equal(voidedPayments.status, 200);
  assert.equal((await voidedPayments.json()).find(item => item.id === paymentBody.id).unallocatedAmount, '0');
  assert.equal((await post(`/api/admin/payments/${paymentBody.id}/allocations`, { requestId: randomUUID(), settlementId: draft.id, amount: 1 }, operatorHeaders)).status, 404);
  const replacement = await post('/api/admin/payments', { requestId: randomUUID(), customerId, paymentDate: `${period}-07`, amount: 50000, reference: 'bank-transfer-replacement' }, operatorHeaders);
  assert.equal(replacement.status, 201);
  assert.equal((await post(`/api/admin/payments/${(await replacement.json()).id}/allocations`, { requestId: randomUUID(), settlementId: draft.id, amount: 50000 }, operatorHeaders)).status, 201);
  const excess=await(await post('/api/admin/payments',{requestId:randomUUID(),customerId,paymentDate:`${period}-08`,amount:12000,reference:'bank-transfer-excess'},operatorHeaders)).json();
  const refundRequestId=randomUUID(),refundBody={requestId:refundRequestId,sourceType:'payment',sourceId:excess.id,refundDate:`${period}-09`,amount:12000,method:'bank_transfer',reference:'PAYMENT-REFUND-1',reason:'초과 입금 반환'};
  const [refund,refundReplay]=await Promise.all([post('/api/admin/refunds',refundBody,operatorHeaders),post('/api/admin/refunds',refundBody,operatorHeaders)]);
  assert.equal(refund.status,201);assert.deepEqual(await refund.json(),await refundReplay.json());
  assert.equal((await post(`/api/admin/payments/${excess.id}/void`,{requestId:randomUUID(),reason:'환불 완료 입금 취소 시도'},operatorHeaders)).status,409);
}));
