const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const pg = require('pg');
const argon2 = require('argon2');
const { chromium, expect } = require('@playwright/test');

const webOrigin = 'http://127.0.0.1:3101';
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const step = message => console.log(`E2E: ${message}`);
const settleWithin = (promise, milliseconds) => Promise.race([
  promise,
  new Promise(resolve => setTimeout(resolve, milliseconds)),
]);

async function removeFixture(db, fixture) {
  const { customerId, customerUserId, operatorId, warehouseUserId, warehouseId, productId, supplierId } = fixture;
  const orderIds = (await db.query('SELECT id FROM orders WHERE customer_id=$1', [customerId])).rows.map(row => row.id);
  if (orderIds.length) {
    await db.query('DELETE FROM shipment_work_line_events WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=ANY($1::uuid[]))', [orderIds]);
    await db.query('DELETE FROM shipment_work_lines WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE l.order_id=ANY($1::uuid[]))', [orderIds]);
    await db.query('DELETE FROM shipment_work_assignment_events WHERE order_id=ANY($1::uuid[])', [orderIds]);
    await db.query('DELETE FROM shipment_work_assignments WHERE order_id=ANY($1::uuid[])', [orderIds]);
    await db.query('DELETE FROM payment_allocation_reversals WHERE payment_allocation_id IN (SELECT id FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE customer_id=$1))', [customerId]);
    await db.query('DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE customer_id=$1)', [customerId]);
    await db.query('DELETE FROM payments WHERE customer_id=$1', [customerId]);
    await db.query('DELETE FROM settlement_lines WHERE receivable_entry_id IN (SELECT id FROM receivable_entries WHERE customer_id=$1)', [customerId]);
    await db.query('DELETE FROM settlements WHERE customer_id=$1', [customerId]);
    await db.query('DELETE FROM receivable_entries WHERE return_credit_id IN (SELECT rc.id FROM return_credits rc JOIN return_lines rl ON rl.id=rc.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
    await db.query('DELETE FROM return_credits WHERE return_line_id IN (SELECT rl.id FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
    await db.query('DELETE FROM receivable_entries WHERE shipment_line_id IN (SELECT sl.id FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=ANY($1::uuid[]))', [orderIds]);
    await db.query('DELETE FROM return_defect_dispositions WHERE return_inspection_id IN (SELECT ri.id FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
    await db.query('DELETE FROM inventory_movements WHERE return_inspection_id IN (SELECT ri.id FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
    await db.query('DELETE FROM return_inspections WHERE return_line_id IN (SELECT rl.id FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
    await db.query('DELETE FROM return_lines WHERE return_id IN (SELECT id FROM returns WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[])))', [orderIds]);
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
  await db.query('DELETE FROM command_results WHERE actor_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId]]);
  await db.query('DELETE FROM inventory_movements WHERE receipt_line_id IN (SELECT id FROM receipt_lines WHERE receipt_id IN (SELECT id FROM receipts WHERE supplier_id=$1 AND warehouse_id=$2))', [supplierId, warehouseId]);
  await db.query('DELETE FROM receipt_lines WHERE receipt_id IN (SELECT id FROM receipts WHERE supplier_id=$1 AND warehouse_id=$2)', [supplierId, warehouseId]);
  await db.query('DELETE FROM receipts WHERE supplier_id=$1 AND warehouse_id=$2', [supplierId, warehouseId]);
  await db.query('DELETE FROM inventory_balances WHERE warehouse_id=$1', [warehouseId]);
  await db.query('DELETE FROM customer_prices WHERE customer_id=$1 AND product_id=$2', [customerId, productId]);
  await db.query('DELETE FROM products WHERE id=$1', [productId]);
  await db.query('DELETE FROM suppliers WHERE id=$1', [supplierId]);
  await db.query('DELETE FROM warehouses WHERE id=$1', [warehouseId]);
  await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId]]);
  await db.query('DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId]]);
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[customerUserId, operatorId, warehouseUserId]]);
  await db.query('DELETE FROM customers WHERE id=$1', [customerId]);
}

async function removeStaleFixtures(db) {
  const result = await db.query(`SELECT c.id AS "customerId",cu.id AS "customerUserId",ou.id AS "operatorId",wu.id AS "warehouseUserId",
    w.id AS "warehouseId",p.id AS "productId",s.id AS "supplierId"
    FROM customers c
    JOIN users cu ON cu.customer_id=c.id
    JOIN users ou ON ou.email='e2e-operator-'||lower(substring(c.code from 5))||'@example.test'
    JOIN users wu ON wu.email='e2e-warehouse-'||lower(substring(c.code from 5))||'@example.test'
    JOIN warehouses w ON w.code='E2E-WH-'||substring(c.code from 5)
    JOIN products p ON p.sku='E2E-'||substring(c.code from 5)
    JOIN suppliers s ON s.code='E2E-SUP-'||substring(c.code from 5)
    WHERE c.name='Browser E2E customer' AND c.code LIKE 'E2E-%'`);
  for (const fixture of result.rows) await removeFixture(db, fixture);
  return result.rowCount;
}

async function createFixture(db) {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/b2b_stm');
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const fixture = {
    customerId: randomUUID(), customerUserId: randomUUID(), operatorId: randomUUID(), warehouseUserId: randomUUID(),
    warehouseId: randomUUID(), productId: randomUUID(), supplierId: randomUUID(),
    customerEmail: `e2e-customer-${suffix.toLowerCase()}@example.test`, customerPassword: `E2e!${suffix}9`,
    operatorSession: token(), warehouseSession: token(), sku: `E2E-${suffix}`,
  };
  const customerPasswordHash = await argon2.hash(fixture.customerPassword, { type: argon2.argon2id });
  await db.query("INSERT INTO customers(id,code,name) VALUES ($1,$2,'Browser E2E customer')", [fixture.customerId, `E2E-${suffix}`]);
  await db.query("INSERT INTO users(id,email,password_hash,account_type,customer_id) VALUES ($1,$2,$3,'customer',$4),($5,$6,NULL,'internal',NULL),($7,$8,NULL,'internal',NULL)", [fixture.customerUserId, fixture.customerEmail, customerPasswordHash, fixture.customerId, fixture.operatorId, `e2e-operator-${suffix.toLowerCase()}@example.test`, fixture.warehouseUserId, `e2e-warehouse-${suffix.toLowerCase()}@example.test`]);
  await db.query("INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,'customer','customer'),($2,'internal','operations'),($2,'internal','settlement'),($3,'internal','warehouse')", [fixture.customerUserId, fixture.operatorId, fixture.warehouseUserId]);
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at) VALUES ($1,$2,now()+interval '12 hours',now(),now()),($3,$4,now()+interval '12 hours',now(),NULL)", [digest(fixture.operatorSession), fixture.operatorId, digest(fixture.warehouseSession), fixture.warehouseUserId]);
  await db.query("INSERT INTO warehouses(id,code,name) VALUES ($1,$2,'Browser E2E warehouse')", [fixture.warehouseId, `E2E-WH-${suffix}`]);
  await db.query("INSERT INTO suppliers(id,code,name) VALUES ($1,$2,'Browser E2E supplier')", [fixture.supplierId, `E2E-SUP-${suffix}`]);
  await db.query("INSERT INTO products(id,sku,name,sale_unit) VALUES ($1,$2,'Browser E2E cup','box')", [fixture.productId, fixture.sku]);
  await db.query("INSERT INTO customer_prices(customer_id,product_id,unit_price,tax_category,tax_rate_bps) VALUES ($1,$2,10000,'exempt',0)", [fixture.customerId, fixture.productId]);
  await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity) VALUES ($1,$2,5)', [fixture.warehouseId, fixture.productId]);
  return fixture;
}

async function authenticatedContext(browser, session) {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'b2b_session', value: session, url: webOrigin, httpOnly: true, sameSite: 'Lax' }]);
  return context;
}

async function expectPost(page, path, click) {
  const [completed] = await Promise.all([
    page.waitForResponse(candidate => candidate.request().method() === 'POST' && candidate.url().includes(path)),
    click(),
  ]);
  expect(completed.ok()).toBeTruthy();
  return completed;
}

(async () => {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const browser = await chromium.launch({ headless: true });
  let fixture, customer, admin, warehouse;
  try {
    await db.connect();
    await db.query("SELECT pg_advisory_lock(hashtext('b2b-stm-browser-e2e'))");
    const removedFixtures = await removeStaleFixtures(db);
    if (removedFixtures) step(`removed ${removedFixtures} stale fixture(s)`);
    fixture = await createFixture(db);
    step('fixture created');
    customer = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const customerPage = await customer.newPage();
    customerPage.setDefaultTimeout(10_000);
    customerPage.setDefaultNavigationTimeout(20_000);
    await customerPage.goto(webOrigin, { waitUntil: 'networkidle' });
    await expect(customerPage.locator('input[type="email"]')).toBeVisible();
    await expect(customerPage.locator('input[type="password"]')).toBeVisible();
    await customerPage.locator('input[type="email"]').fill(fixture.customerEmail);
    await customerPage.locator('input[type="password"]').fill(fixture.customerPassword);
    const catalogResponsePromise = customerPage.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/orders/catalog'));
    await expectPost(customerPage, '/api/auth/login', () => customerPage.getByRole('button', { name: '로그인' }).click());
    await customerPage.waitForURL(`${webOrigin}/portal/orders`);
    expect((await catalogResponsePromise).ok()).toBeTruthy();
    await expect(customerPage.getByRole('heading', { name: '상품 주문' })).toBeVisible();
    step('customer logged in');
    step('selecting fixture warehouse');
    await customerPage.getByLabel('출고 창고').selectOption(fixture.warehouseId);
    step('fixture warehouse selected');
    await customerPage.getByLabel('Browser E2E cup 주문 수량').fill('8');
    await expectPost(customerPage, '/api/orders', () => customerPage.getByRole('button', { name: '주문 접수', exact: true }).click());
    const submittedOrder = (await db.query('SELECT id FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1', [fixture.customerId])).rows[0];
    assert(submittedOrder?.id, 'Submitted order was not persisted');
    step('order submitted');

    admin = await authenticatedContext(browser, fixture.operatorSession);
    const adminPage = await admin.newPage();
    adminPage.setDefaultTimeout(10_000);
    adminPage.setDefaultNavigationTimeout(20_000);
    await adminPage.goto(`${webOrigin}/admin/orders`, { waitUntil: 'networkidle' });
    await adminPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expect(adminPage.getByRole('button', { name: '주문 확정 · 재고 예약' })).toBeVisible();
    await expectPost(adminPage, '/api/admin/orders/', () => adminPage.getByRole('button', { name: '주문 확정 · 재고 예약' }).click());
    step('order confirmed');

    await adminPage.goto(`${webOrigin}/admin`, { waitUntil: 'networkidle' });
    await adminPage.getByLabel('공급처').selectOption(fixture.supplierId);
    await adminPage.getByLabel('창고').selectOption(fixture.warehouseId);
    await adminPage.getByLabel('상품').selectOption(fixture.productId);
    await adminPage.getByLabel('입고 수량').fill('3');
    await expectPost(adminPage, '/api/admin/receipts', () => adminPage.getByRole('button', { name: '입고 확정' }).click());
    await adminPage.goto(`${webOrigin}/admin/orders`, { waitUntil: 'networkidle' });
    await adminPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expect(adminPage.getByRole('button', { name: '미확보 재배정' })).toBeVisible();
    await expectPost(adminPage, '/allocate', () => adminPage.getByRole('button', { name: '미확보 재배정' }).click());
    await expect(adminPage.getByRole('group', { name: '출고 예약 8' })).toBeVisible();
    await expect(adminPage.getByRole('group', { name: '미확보 대기 0' })).toBeVisible();
    step('new receipt reallocated to waiting quantity');

    warehouse = await authenticatedContext(browser, fixture.warehouseSession);
    const warehousePage = await warehouse.newPage();
    warehousePage.setDefaultTimeout(10_000);
    warehousePage.setDefaultNavigationTimeout(20_000);
    await warehousePage.goto(`${webOrigin}/warehouse/shipments`, { waitUntil: 'networkidle' });
    await warehousePage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expectPost(warehousePage, `/api/warehouse/shipments/orders/${submittedOrder.id}/claim`, () => warehousePage.getByRole('button', { name: '작업 시작', exact: true }).click());
    await warehousePage.getByLabel('Browser E2E cup 피킹 수량').fill('3');
    await expectPost(warehousePage, `/api/warehouse/shipments/orders/${submittedOrder.id}/pick`, () => warehousePage.getByRole('button', { name: '피킹 수량 저장', exact: true }).click());
    await warehousePage.getByLabel('Browser E2E cup 검수 수량').fill('3');
    await expectPost(warehousePage, `/api/warehouse/shipments/orders/${submittedOrder.id}/inspect`, () => warehousePage.getByRole('button', { name: '검수 완료 저장', exact: true }).click());
    await warehousePage.getByLabel('Browser E2E cup 출고 수량').fill('3');
    await expectPost(warehousePage, '/api/warehouse/shipments', () => warehousePage.getByRole('button', { name: '출고 확정', exact: true }).click());
    await expect(warehousePage.getByRole('group', { name: '출고 후 잔량 5개' })).toBeVisible();
    step('partial shipment verified in warehouse');

    await adminPage.goto(`${webOrigin}/admin/orders`, { waitUntil: 'networkidle' });
    await adminPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expect(adminPage.getByRole('group', { name: '누적 출고 3' })).toBeVisible();
    await expect(adminPage.getByRole('group', { name: '출고 예약 5' })).toBeVisible();
    step('partial shipment verified in admin');

    await adminPage.goto(`${webOrigin}/admin/order-history`, { waitUntil: 'networkidle' });
    await adminPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expect(adminPage.getByRole('group', { name: '누적 출고 3' })).toBeVisible();
    await expect(adminPage.getByText('실제 출고 원장', { exact: true })).toBeVisible();
    await expect(adminPage.getByRole('columnheader', { name: '매출 원장' })).toBeVisible();
    step('shipment ledger verified in admin history');

    await customerPage.goto(`${webOrigin}/portal/orders/history`, { waitUntil: 'networkidle' });
    await customerPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expect(customerPage.getByRole('group', { name: '누적 출고 3' })).toBeVisible();
    await expect(customerPage.getByRole('group', { name: '출고 예약 5' })).toBeVisible();
    step('partial shipment verified in customer history');

    await customerPage.goto(`${webOrigin}/portal/returns`, { waitUntil: 'networkidle' });
    await customerPage.getByLabel('Browser E2E cup 반품 수량').fill('1');
    await customerPage.getByLabel('Browser E2E cup 반품 사유').fill('Damaged packaging');
    await expectPost(customerPage, '/api/returns', () => customerPage.getByRole('button', { name: '반품 요청 접수', exact: true }).click());
    step('return requested');

    await warehousePage.goto(`${webOrigin}/warehouse/returns`, { waitUntil: 'networkidle' });
    const returnCard = warehousePage.locator('[data-slot="card"]').filter({ hasText: 'Browser E2E cup' });
    await returnCard.getByLabel('입고 수량', { exact: true }).fill('1');
    await returnCard.getByLabel('정상', { exact: true }).fill('0');
    await returnCard.getByLabel('불량', { exact: true }).fill('1');
    await returnCard.getByLabel('불량 사유', { exact: true }).fill('Cracked during transit');
    await expectPost(warehousePage, '/api/warehouse/returns/lines/', () => returnCard.getByRole('button', { name: '검수 확정', exact: true }).click());
    step('return inspected');

    await adminPage.goto(`${webOrigin}/admin/return-credits`, { waitUntil: 'networkidle' });
    await expect(adminPage.getByRole('button', { name: '차감 확정' })).toBeVisible();
    await expectPost(adminPage, '/api/admin/returns/inspections/', () => adminPage.getByRole('button', { name: '불량 보류' }).click());
    await expectPost(adminPage, '/credit', () => adminPage.getByRole('button', { name: '차감 확정' }).click());
    step('return credit confirmed');

    await adminPage.goto(`${webOrigin}/admin/settlement-drafts`, { waitUntil: 'networkidle' });
    await adminPage.getByLabel('거래처').selectOption(fixture.customerId);
    await adminPage.getByLabel('정산월').fill(new Date().toISOString().slice(0, 7));
    await expectPost(adminPage, '/api/admin/settlements', () => adminPage.getByRole('button', { name: '초안 생성' }).click());
    await expectPost(adminPage, '/finalize', () => adminPage.getByRole('button', { name: '정산 마감' }).click());
    step('settlement finalized');

    await adminPage.goto(`${webOrigin}/admin/payments`, { waitUntil: 'networkidle' });
    const paymentForm = adminPage.locator('form:has(select[name="customerId"])');
    await paymentForm.locator('select[name="customerId"]').selectOption(fixture.customerId);
    await paymentForm.locator('input[name="paymentDate"]').fill(new Date().toISOString().slice(0, 10));
    await paymentForm.locator('input[name="amount"]').fill('20000');
    await paymentForm.locator('input[name="reference"]').fill(`E2E-${fixture.sku}`);
    await expectPost(adminPage, '/api/admin/payments', () => paymentForm.getByRole('button', { name: '입금 등록' }).click());
    const allocationForm = adminPage.locator('form:has(select[name="settlementId"])');
    await allocationForm.locator('select[name="settlementId"]').selectOption({ index: 1 });
    await allocationForm.locator('input[name="amount"]').fill('20000');
    await expectPost(adminPage, '/allocations', () => allocationForm.locator('button').click());
    step('payment allocated');

    const result = await db.query("SELECT s.status,COALESCE((SELECT sum(sl.amount) FROM settlement_lines sl WHERE sl.settlement_id=s.id),0) AS total_amount,COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa LEFT JOIN payment_allocation_reversals pr ON pr.payment_allocation_id=pa.id WHERE pa.settlement_id=s.id AND pr.id IS NULL),0) AS allocated_amount FROM settlements s WHERE s.customer_id=$1", [fixture.customerId]);
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].status, 'finalized');
    assert.equal(String(result.rows[0].allocated_amount), '20000');

    await customerPage.goto(`${webOrigin}/portal/orders/history`, { waitUntil: 'networkidle' });
    await customerPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await customerPage.getByLabel('잔량 취소 요청 사유').fill('E2E 행사 종료로 남은 수량 취소 요청');
    await expectPost(customerPage, `/api/orders/${submittedOrder.id}/cancellation-requests`, () => customerPage.getByRole('button', { name: '잔량 취소 요청', exact: true }).click());
    await expect(customerPage.getByText('잔량 취소 검토 중', { exact: true })).toBeVisible();
    assert.equal(await customerPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await customerPage.screenshot({ path: path.resolve(__dirname, '../../../docs/screenshots/sdtpl-customer-cancellation-request-mobile.png'), fullPage: true });
    await customerPage.setViewportSize({ width: 1440, height: 1000 });
    await customerPage.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await customerPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await customerPage.screenshot({ path: path.resolve(__dirname, '../../../docs/screenshots/sdtpl-customer-cancellation-request-desktop.png'), fullPage: true });
    await customerPage.setViewportSize({ width: 390, height: 844 });
    step('customer cancellation request submitted');

    await warehousePage.goto(`${webOrigin}/warehouse/shipments`, { waitUntil: 'networkidle' });
    await expect(warehousePage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) })).toHaveCount(0);
    step('shipment held during cancellation review');

    await adminPage.goto(`${webOrigin}/admin/orders`, { waitUntil: 'networkidle' });
    await adminPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expect(adminPage.getByText('거래처 미출고 잔량 취소 요청', { exact: true })).toBeVisible();
    await adminPage.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await adminPage.screenshot({ path: path.resolve(__dirname, '../../../docs/screenshots/sdtpl-admin-cancellation-review-desktop.png'), fullPage: true });
    await adminPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await adminPage.screenshot({ path: path.resolve(__dirname, '../../../docs/screenshots/sdtpl-admin-cancellation-review-mobile.png'), fullPage: true });
    await adminPage.setViewportSize({ width: 1280, height: 720 });
    await expectPost(adminPage, '/approve', () => adminPage.getByRole('button', { name: '잔량 취소 승인', exact: true }).click());
    step('administrator approved cancellation request');

    await adminPage.goto(`${webOrigin}/admin/order-history`, { waitUntil: 'networkidle' });
    await adminPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    const cancellationAudit = adminPage.getByText('취소 요청 검토 기록', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    await expect(cancellationAudit.getByText('E2E 행사 종료로 남은 수량 취소 요청', { exact: true })).toBeVisible();
    await expect(adminPage.getByText('승인', { exact: true })).toBeVisible();
    await customerPage.goto(`${webOrigin}/portal/orders/history`, { waitUntil: 'networkidle' });
    await customerPage.getByRole('button', { name: new RegExp(submittedOrder.id.slice(0, 8).toUpperCase()) }).click();
    await expect(customerPage.getByText('주문 취소 사유', { exact: true })).toBeVisible();
    await expect(customerPage.getByText('E2E 행사 종료로 남은 수량 취소 요청', { exact: true }).first()).toBeVisible();
    const cancellationState = await db.query(`SELECT o.status,r.status AS reservation_status,r.shipped_quantity,b.reserved_quantity,
      (SELECT count(*)::int FROM receivable_entries re JOIN shipment_lines sl ON sl.id=re.shipment_line_id JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=o.id) AS ledger_count
      FROM orders o JOIN order_lines l ON l.order_id=o.id JOIN reservations r ON r.order_line_id=l.id
      JOIN inventory_balances b ON b.warehouse_id=o.warehouse_id AND b.product_id=l.product_id WHERE o.id=$1`, [submittedOrder.id]);
    assert.deepEqual(cancellationState.rows[0], { status: 'cancelled', reservation_status: 'released', shipped_quantity: 3, reserved_quantity: 0, ledger_count: 1 });
    step('approved cancellation preserved shipped ledger and released remaining reservation');

    await expectPost(adminPage, '/api/auth/logout', () => adminPage.getByRole('button', { name: '로그아웃' }).click());
    await adminPage.waitForURL(`${webOrigin}/`);
    console.log('PASS: browser login, order, partial shipment, return, settlement, payment, cancellation review, and logout');
  } finally {
    step('closing browser contexts');
    await settleWithin(Promise.allSettled([customer?.close(), admin?.close(), warehouse?.close()]), 5_000);
    await settleWithin(browser.close(), 5_000);
    step('removing fixture');
    if (fixture) await removeFixture(db, fixture);
    await db.query("SELECT pg_advisory_unlock(hashtext('b2b-stm-browser-e2e'))").catch(() => {});
    await db.end();
    step('cleanup complete');
  }
})().catch(error => { console.error(error); process.exit(1); });
