import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { createRequire } from 'node:module';
import pg from 'pg';
import { csrfHeaders, origin } from './helpers/csrf.mjs';

const { createApplication } = createRequire(import.meta.url)('../../apps/api/dist/application.js');
const csrfSecret = 'a'.repeat(64);

async function dropFirstResponse(targetPort, path, headers, body) {
  let dropped;
  const responseDropped = new Promise(resolve => { dropped = resolve; });
  const proxy = createServer(client => {
    const upstream = createConnection({ host: '127.0.0.1', port: targetPort });
    client.pipe(upstream);
    upstream.once('data', () => {
      client.destroy();
      upstream.destroy();
      dropped();
    });
    upstream.once('error', () => client.destroy());
    client.once('error', () => upstream.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const port = proxy.address().port;
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    await responseDropped;
  } finally {
    await new Promise(resolve => proxy.close(resolve));
  }
}

test('committed order survives lost response and API restart without duplication', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  const customerId = randomUUID(), userId = randomUUID(), warehouseId = randomUUID(), productId = randomUUID();
  const session = randomBytes(32).toString('hex'), requestId = randomUUID();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  let firstApp, secondApp;
  await db.connect();
  try {
    await db.query("INSERT INTO customers(id,code,name) VALUES($1,$2,'Fault recovery customer')", [customerId, `FAULT-${suffix}`]);
    await db.query("INSERT INTO users(id,email,account_type,customer_id) VALUES($1,$2,'customer',$3)", [userId, `fault-${suffix.toLowerCase()}@example.test`, customerId]);
    await db.query("INSERT INTO user_roles(user_id,account_type,role) VALUES($1,'customer','customer')", [userId]);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [createHash('sha256').update(session).digest('hex'), userId]);
    await db.query("INSERT INTO warehouses(id,code,name) VALUES($1,$2,'Fault recovery warehouse')", [warehouseId, `FAULT-${suffix}`]);
    await db.query("INSERT INTO products(id,sku,name,sale_unit) VALUES($1,$2,'Fault recovery product','box')", [productId, `FAULT-${suffix}`]);
    await db.query("INSERT INTO customer_prices(customer_id,product_id,unit_price,tax_category,tax_rate_bps) VALUES($1,$2,1000,'exempt',0)", [customerId, productId]);
    await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity) VALUES($1,$2,10)', [warehouseId, productId]);

    firstApp = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL, CSRF_SECRET: csrfSecret });
    await firstApp.listen(0, '127.0.0.1');
    const firstUrl = new URL(await firstApp.getUrl());
    const headers = await csrfHeaders(firstUrl.origin, `b2b_session=${session}`);
    const body = { requestId, warehouseId, lines: [{ productId, quantity: 2 }] };
    await dropFirstResponse(Number(firstUrl.port), '/api/orders', headers, body);

    const committed = await db.query("SELECT response FROM command_results WHERE actor_id=$1 AND command_type='order.submit' AND request_id=$2", [userId, requestId]);
    assert.equal(committed.rowCount, 1);
    const orderId = committed.rows[0].response.id;
    await firstApp.close(); firstApp = undefined;

    secondApp = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL, CSRF_SECRET: csrfSecret });
    await secondApp.listen(0, '127.0.0.1');
    const retry = await fetch(`${await secondApp.getUrl()}/api/orders`, {
      method: 'POST',
      headers: { ...headers, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).id, orderId);
    assert.equal((await db.query('SELECT count(*)::int count FROM orders WHERE id=$1', [orderId])).rows[0].count, 1);
    assert.equal((await db.query('SELECT count(*)::int count FROM order_lines WHERE order_id=$1', [orderId])).rows[0].count, 1);
    assert.equal((await db.query("SELECT count(*)::int count FROM command_results WHERE actor_id=$1 AND command_type='order.submit' AND request_id=$2", [userId, requestId])).rows[0].count, 1);
  } finally {
    await firstApp?.close().catch(() => {});
    await secondApp?.close().catch(() => {});
    await db.query('DELETE FROM notification_outbox WHERE aggregate_id IN (SELECT id FROM orders WHERE customer_id=$1)', [customerId]).catch(() => {});
    await db.query("DELETE FROM command_results WHERE actor_id=$1 AND command_type='order.submit' AND request_id=$2", [userId, requestId]).catch(() => {});
    await db.query('DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE customer_id=$1)', [customerId]).catch(() => {});
    await db.query('DELETE FROM orders WHERE customer_id=$1', [customerId]).catch(() => {});
    await db.query('DELETE FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId]).catch(() => {});
    await db.query('DELETE FROM customer_prices WHERE customer_id=$1 AND product_id=$2', [customerId, productId]).catch(() => {});
    await db.query('DELETE FROM products WHERE id=$1', [productId]).catch(() => {});
    await db.query('DELETE FROM warehouses WHERE id=$1', [warehouseId]).catch(() => {});
    await db.query('DELETE FROM sessions WHERE user_id=$1', [userId]).catch(() => {});
    await db.query('DELETE FROM user_roles WHERE user_id=$1', [userId]).catch(() => {});
    await db.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
    await db.query('DELETE FROM customers WHERE id=$1', [customerId]).catch(() => {});
    await db.end().catch(() => {});
  }
});
