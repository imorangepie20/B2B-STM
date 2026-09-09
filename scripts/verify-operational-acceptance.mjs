import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { assertLocalRehearsalTarget } from './lib/operational-integrity.mjs';
import { evaluateReadSmoke, summarizeMeasurements } from './lib/performance-metrics.mjs';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
assert(connectionString, 'DATABASE_URL is required');
assertLocalRehearsalTarget(connectionString);

const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3200';
const concurrency = Number(process.env.ACCEPTANCE_CONCURRENCY ?? 30);
const requestCount = Number(process.env.ACCEPTANCE_REQUESTS ?? 300);
const targets = {
  p95Ms: Number(process.env.ACCEPTANCE_READ_P95_MS ?? 1000),
  unexpectedErrorRate: Number(process.env.ACCEPTANCE_ERROR_RATE ?? 0.001),
};
assert(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 100, 'ACCEPTANCE_CONCURRENCY must be 1..100');
assert(Number.isInteger(requestCount) && requestCount >= concurrency && requestCount <= 10000, 'ACCEPTANCE_REQUESTS must be between concurrency and 10000');

const pool = new Pool({ connectionString, max: 5 });
const digest = value => createHash('sha256').update(value).digest('hex');
const sessionDefinitions = [
  { key: 'customer', email: 'demo.customer@stm.local', mfa: false },
  { key: 'warehouse', email: 'demo.warehouse@stm.local', mfa: false },
  { key: 'operations', email: 'demo.operations@stm.local', mfa: true },
  { key: 'operationsWithoutMfa', email: 'demo.operations@stm.local', mfa: false },
];

const performanceRoutes = [
  { role: 'operations', path: '/api/admin/dashboard' },
  { role: 'operations', path: '/api/admin/catalog' },
  { role: 'operations', path: '/api/admin/inventory' },
  { role: 'operations', path: '/api/admin/orders' },
  { role: 'operations', path: '/api/admin/settlements' },
  { role: 'warehouse', path: '/api/warehouse/shipments/queue' },
  { role: 'warehouse', path: '/api/warehouse/returns/queue' },
  { role: 'customer', path: '/api/orders/catalog' },
  { role: 'customer', path: '/api/orders' },
  { role: 'customer', path: '/api/receivables' },
  { role: 'customer', path: '/api/payments' },
];

function cookie(token) {
  return { cookie: `b2b_session=${token}` };
}

async function request(path, token, expectedStatus = 200) {
  const started = performance.now();
  const response = await fetch(`${apiOrigin}${path}`, token ? { headers: cookie(token) } : undefined);
  await response.arrayBuffer();
  return {
    path,
    durationMs: performance.now() - started,
    status: response.status,
    expectedStatus,
  };
}

async function createSessions() {
  const sessions = {};
  for (const definition of sessionDefinitions) {
    const user = await pool.query('SELECT id FROM users WHERE email=$1 AND active', [definition.email]);
    assert.equal(user.rowCount, 1, `Demo user missing: ${definition.email}; run npm.cmd run demo:seed`);
    const token = randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at)
       VALUES($1,$2,now()+interval '1 hour',now(),CASE WHEN $3 THEN now() ELSE NULL END)`,
      [digest(token), user.rows[0].id, definition.mfa],
    );
    sessions[definition.key] = token;
  }
  return sessions;
}

async function verifyPermissions(sessions) {
  const cases = [
    { name: 'anonymous protected endpoint', path: '/api/orders', status: 401 },
    { name: 'customer own orders', role: 'customer', path: '/api/orders', status: 200 },
    { name: 'customer blocked from admin', role: 'customer', path: '/api/admin/catalog', status: 403 },
    { name: 'customer blocked from warehouse', role: 'customer', path: '/api/warehouse/shipments/queue', status: 403 },
    { name: 'warehouse own queue', role: 'warehouse', path: '/api/warehouse/shipments/queue', status: 200 },
    { name: 'warehouse blocked from customer', role: 'warehouse', path: '/api/orders', status: 403 },
    { name: 'warehouse blocked from admin', role: 'warehouse', path: '/api/admin/catalog', status: 403 },
    { name: 'operations requires MFA', role: 'operationsWithoutMfa', path: '/api/admin/catalog', status: 403 },
    { name: 'MFA operations admin access', role: 'operations', path: '/api/admin/catalog', status: 200 },
  ];
  const results = [];
  for (const check of cases) {
    const result = await request(check.path, check.role ? sessions[check.role] : undefined, check.status);
    results.push({ name: check.name, expected: check.status, actual: result.status, passed: result.status === check.status });
  }
  assert.equal(results.every(result => result.passed), true, `Permission matrix failed: ${JSON.stringify(results)}`);
  return results;
}

async function runLoad(sessions) {
  let nextIndex = 0;
  const measurements = [];
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= requestCount) return;
      const route = performanceRoutes[index % performanceRoutes.length];
      measurements.push(await request(route.path, sessions[route.role]));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return measurements;
}

function groupSummaries(measurements) {
  return Object.fromEntries(
    performanceRoutes.map(route => {
      const routeMeasurements = measurements.filter(measurement => measurement.path === route.path);
      return [route.path, summarizeMeasurements(routeMeasurements)];
    }),
  );
}

let sessions = {};
try {
  const health = await fetch(`${apiOrigin}/api/health/live`);
  assert.equal(health.status, 200, `API is not healthy at ${apiOrigin}`);
  sessions = await createSessions();
  const permissions = await verifyPermissions(sessions);
  for (const route of performanceRoutes) await request(route.path, sessions[route.role]);
  const measurements = await runLoad(sessions);
  const summary = summarizeMeasurements(measurements);
  const failures = evaluateReadSmoke(summary, targets);
  const report = {
    kind: 'local-operational-acceptance-smoke',
    scope: {
      dataset: 'current development database with real demo records',
      concurrency,
      requests: requestCount,
      limitation: 'This is not the 100,000-order, 1,000,000-line, 30-minute full benchmark.',
    },
    targets,
    permissions,
    performance: { overall: summary, byEndpoint: groupSummaries(measurements) },
    passed: failures.length === 0,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  assert.equal(failures.length, 0, failures.join('; '));
} finally {
  const hashes = Object.values(sessions).map(digest);
  if (hashes.length) {
    const deleted = await pool.query('DELETE FROM sessions WHERE token_hash=ANY($1::text[]) RETURNING token_hash', [hashes]);
    assert.equal(deleted.rowCount, hashes.length, 'Operational acceptance sessions were not fully removed');
  }
  await pool.end();
}
