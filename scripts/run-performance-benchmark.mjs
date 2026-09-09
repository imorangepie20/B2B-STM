import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { performanceDatabaseUrl, assertPerformanceTarget } from './lib/performance-target.mjs';
import { buildArrivalSchedule, buildWorkloadPlan, summarizeMixedWorkload } from './lib/performance-workload.mjs';
import { summarizeMeasurements } from './lib/performance-metrics.mjs';

const require = createRequire(import.meta.url);
const { createApplication } = require('../apps/api/dist/application.js');
const { Client } = pg;
assert(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
const connectionString = performanceDatabaseUrl(process.env.TEST_DATABASE_URL);
assertPerformanceTarget(connectionString);

const concurrency = Number(process.env.PERF_CONCURRENCY ?? 30);
const requestCount = Number(process.env.PERF_REQUESTS ?? 300);
const intervalMs = Number(process.env.PERF_USER_INTERVAL_MS ?? 3000);
assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 100, 'PERF_CONCURRENCY must be 1..100');
const workload = buildWorkloadPlan(requestCount);
const arrivals = buildArrivalSchedule(requestCount, concurrency, intervalMs);
const targets = {
  readP95Ms: Number(process.env.PERF_READ_P95_MS ?? 1000),
  writeP95Ms: Number(process.env.PERF_WRITE_P95_MS ?? 2000),
  unexpectedErrorRate: Number(process.env.PERF_ERROR_RATE ?? 0.001),
};
const origin = 'http://127.0.0.1:3100';
const db = new Client({ connectionString });
const digest = value => createHash('sha256').update(value).digest('hex');
const tokens = { customer: randomBytes(32).toString('hex'), operations: randomBytes(32).toString('hex') };
let app;
let benchmarkStartedAt;

function groupByRoute(measurements) {
  return Object.fromEntries([...new Set(measurements.map(item => item.route))].sort().map(route => [
    route,
    summarizeMeasurements(measurements.filter(item => item.route === route)),
  ]));
}

async function csrfHeaders(base, token) {
  const sessionCookie = `b2b_session=${token}`;
  const response = await fetch(`${base}/api/auth/csrf`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200, 'CSRF token issuance failed');
  const { csrfToken } = await response.json();
  const csrfCookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return { origin, cookie: `${sessionCookie}; ${csrfCookie}`, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
}

async function measuredFetch(base, definition) {
  const started = performance.now();
  const response = await fetch(`${base}${definition.path}`, definition.options);
  await response.arrayBuffer();
  return {
    kind: definition.kind,
    route: definition.route,
    durationMs: performance.now() - started,
    status: response.status,
    expectedStatus: definition.expectedStatus,
  };
}

try {
  await db.connect();
  const fixture = (await db.query(`SELECT json_build_object(
    'customers',(SELECT count(*)::int FROM customers),
    'products',(SELECT count(*)::int FROM products),
    'orders',(SELECT count(*)::int FROM orders),
    'orderLines',(SELECT count(*)::int FROM order_lines)
  ) AS result`)).rows[0].result;
  assert(fixture.orders > 0 && fixture.orderLines > 0, 'Seed the performance fixture before benchmarking');
  const customer = (await db.query("SELECT id,customer_id FROM users WHERE email='perf.customer.0001@stm.local'")).rows[0];
  const operations = (await db.query("SELECT id FROM users WHERE email='perf.operations@stm.local'")).rows[0];
  const warehouse = (await db.query("SELECT id FROM warehouses WHERE code='PERF-WH-0001'")).rows[0];
  const product = (await db.query("SELECT id FROM products WHERE sku='PERF-SKU-00001'")).rows[0];
  assert(customer && operations && warehouse && product, 'Performance fixture actors or catalog are missing');
  await db.query(`INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at)
    VALUES($1,$2,now()+interval '1 hour',now(),NULL),($3,$4,now()+interval '1 hour',now(),now())`,
    [digest(tokens.customer), customer.id, digest(tokens.operations), operations.id]);
  benchmarkStartedAt = (await db.query('SELECT clock_timestamp() AS value')).rows[0].value;

  app = await createApplication({
    ...process.env,
    DATABASE_URL: connectionString,
    NODE_ENV: 'performance',
    APP_ORIGIN: origin,
    API_PORT: '3200',
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const customerReadHeaders = { cookie: `b2b_session=${tokens.customer}` };
  const operationsReadHeaders = { cookie: `b2b_session=${tokens.operations}` };
  const customerWriteHeaders = await csrfHeaders(base, tokens.customer);
  const readRoutes = [
    index => ({ route: 'GET /api/orders', path: `/api/orders?page=${index % 2 + 1}&pageSize=50`, options: { headers: customerReadHeaders } }),
    index => ({ route: 'GET /api/admin/orders', path: `/api/admin/orders?page=${index % 20 + 1}&pageSize=50`, options: { headers: operationsReadHeaders } }),
    index => ({ route: 'GET /api/admin/orders/history', path: `/api/admin/orders/history?page=${index % 20 + 1}&pageSize=50`, options: { headers: operationsReadHeaders } }),
  ];
  const runStartedAt = performance.now();
  const waitUntil = async offset => {
    const remaining = runStartedAt + offset - performance.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  };
  const measurements = await Promise.all(arrivals.map(async (offset, index) => {
      await waitUntil(offset);
      if (workload[index] === 'read') {
        const route = readRoutes[index % readRoutes.length](index);
        return measuredFetch(base, { ...route, kind: 'read', expectedStatus: 200 });
      } else {
        return measuredFetch(base, {
          kind: 'write',
          route: 'POST /api/orders',
          path: '/api/orders',
          expectedStatus: 201,
          options: {
            method: 'POST',
            headers: customerWriteHeaders,
            body: JSON.stringify({ requestId: randomUUID(), warehouseId: warehouse.id, lines: [{ productId: product.id, quantity: 1 }] }),
          },
        });
      }
  }));
  const summary = summarizeMixedWorkload(measurements, targets);
  const report = {
    kind: 'isolated-performance-database-mixed-workload',
    fixture,
    workload: { activeUsers: concurrency, userIntervalMs: intervalMs, requests: requestCount, reads: workload.filter(value => value === 'read').length, writes: workload.filter(value => value === 'write').length },
    targets,
    results: { ...summary, byRoute: groupByRoute(measurements) },
    passed: summary.failures.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  assert.equal(summary.failures.length, 0, summary.failures.join('; '));
} finally {
  if (app) await app.close();
  if (benchmarkStartedAt) {
    await db.query('DELETE FROM command_results WHERE actor_id=(SELECT id FROM users WHERE email=$1) AND created_at >= $2', ['perf.customer.0001@stm.local', benchmarkStartedAt]).catch(() => {});
    await db.query('DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE requested_by=(SELECT id FROM users WHERE email=$1) AND created_at >= $2)', ['perf.customer.0001@stm.local', benchmarkStartedAt]).catch(() => {});
    await db.query('DELETE FROM orders WHERE requested_by=(SELECT id FROM users WHERE email=$1) AND created_at >= $2', ['perf.customer.0001@stm.local', benchmarkStartedAt]).catch(() => {});
  }
  await db.query('DELETE FROM sessions WHERE token_hash=ANY($1::text[])', [Object.values(tokens).map(digest)]).catch(() => {});
  await db.end().catch(() => {});
}
