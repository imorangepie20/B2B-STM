import assert from 'node:assert/strict';
import pg from 'pg';
import { assertNoIntegrityViolations, integritySql, snapshotSql } from './lib/operational-integrity.mjs';

async function verifyHttp(origin, path) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
  assert.deepEqual(await response.json(), { status: 'ok' }, `${path} returned an unexpected body`);
}

try {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.pathname, '/b2b_stm', 'B2B development database required');
  const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3200';
  const parsedOrigin = new URL(apiOrigin);
  assert(['http:', 'https:'].includes(parsedOrigin.protocol), 'HTTP API origin required');
  assert.equal(parsedOrigin.pathname, '/', 'API_ORIGIN must not include a path');

  await verifyHttp(apiOrigin.replace(/\/$/, ''), '/api/health/live');
  await verifyHttp(apiOrigin.replace(/\/$/, ''), '/api/health/ready');

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
  try {
    await db.connect();
    const metadata = await db.query("SELECT value FROM application_metadata WHERE key='application'");
    assert.equal(metadata.rows[0]?.value, 'b2b-stm', 'Application metadata mismatch');
    const snapshot = (await db.query(snapshotSql)).rows[0].result;
    const integrity = (await db.query(integritySql)).rows[0].result;
    assertNoIntegrityViolations(integrity);
    console.log(`Operational verification passed: API live/ready, ${Object.keys(snapshot).length} table counts, ${Object.keys(integrity).length} integrity checks`);
  } finally {
    await db.end();
  }
} catch (error) {
  const message = error instanceof Error && (error.name === 'AssertionError' || error.message.startsWith('Operational integrity violation'))
    ? error.message
    : 'API or database operation unavailable';
  console.error(`Operational verification failed: ${message}`);
  process.exitCode = 1;
}
