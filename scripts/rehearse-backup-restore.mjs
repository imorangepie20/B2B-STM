import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import {
  assertLocalRehearsalTarget,
  assertNoIntegrityViolations,
  assertSafeContainerName,
  compareSnapshots,
  integritySql,
  snapshotSql,
} from './lib/operational-integrity.mjs';

const maxBuffer = 512 * 1024 * 1024;

function docker(container, command, input) {
  const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', command], {
    input,
    encoding: input === undefined ? undefined : null,
    maxBuffer,
  });
  if (result.status !== 0) throw new Error('Docker PostgreSQL command failed');
  return result.stdout;
}

async function sourceState(connectionString) {
  const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000, query_timeout: 30_000 });
  try {
    await db.connect();
    const snapshot = (await db.query(snapshotSql)).rows[0].result;
    const integrity = (await db.query(integritySql)).rows[0].result;
    assertNoIntegrityViolations(integrity);
    return { snapshot, integrity };
  } finally {
    await db.end();
  }
}

let backupPath;
let restoreDatabase;
let restoreCreated = false;
let container;

try {
  assert.deepEqual(process.argv.slice(2), ['--development'], 'Run with explicit --development target');
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assertLocalRehearsalTarget(process.env.DATABASE_URL);
  container = assertSafeContainerName(process.env.POSTGRES_CONTAINER ?? 'property-manager-postgres');
  restoreDatabase = `b2b_stm_restore_${randomBytes(6).toString('hex')}`;
  backupPath = join(tmpdir(), `${restoreDatabase}.dump`);

  const source = await sourceState(process.env.DATABASE_URL);
  const startedAt = Date.now();
  const dump = docker(container, 'exec pg_dump -U "$POSTGRES_USER" -d b2b_stm --format=custom --no-owner --no-privileges');
  assert(Buffer.isBuffer(dump) && dump.subarray(0, 5).toString('ascii') === 'PGDMP', 'Invalid PostgreSQL custom backup');
  await writeFile(backupPath, dump, { flag: 'wx', mode: 0o600 });
  const backupMilliseconds = Date.now() - startedAt;

  docker(container, `exec createdb -U "$POSTGRES_USER" -T template0 ${restoreDatabase}`);
  restoreCreated = true;
  const restoreStartedAt = Date.now();
  const backup = await readFile(backupPath);
  docker(container, `exec pg_restore -U "$POSTGRES_USER" -d ${restoreDatabase} --exit-on-error --no-owner --no-privileges`, backup);
  const validation = docker(
    container,
    `exec psql -U "$POSTGRES_USER" -d ${restoreDatabase} -X -A -t -v ON_ERROR_STOP=1`,
    Buffer.from(`${snapshotSql};\n${integritySql};\nSELECT count(*)::int FROM migration_meta.migrations WHERE name='0023_order_cancellation_requests.sql';\n`),
  ).toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  assert.equal(validation.length, 3, 'Unexpected restore validation output');
  const restoredSnapshot = JSON.parse(validation[0]);
  const restoredIntegrity = JSON.parse(validation[1]);
  assert.equal(Number(validation[2]), 1, 'Latest migration missing from restored database');
  compareSnapshots(source.snapshot, restoredSnapshot);
  assertNoIntegrityViolations(restoredIntegrity);
  const restoreMilliseconds = Date.now() - restoreStartedAt;

  console.log(JSON.stringify({
    status: 'passed',
    backupBytes: dump.length,
    backupMilliseconds,
    restoreAndVerifyMilliseconds: restoreMilliseconds,
    comparedTables: Object.keys(source.snapshot).length,
    integrityChecks: Object.keys(source.integrity).length,
  }));
} catch (error) {
  const safeMessage = error instanceof Error && error.name === 'AssertionError' ? error.message : 'Backup or restore command failed';
  console.error(`Backup restore rehearsal failed: ${safeMessage}`);
  process.exitCode = 1;
} finally {
  if (restoreCreated && container && restoreDatabase) {
    try { docker(container, `exec dropdb -U "$POSTGRES_USER" --force ${restoreDatabase}`); }
    catch { console.error('Backup restore rehearsal cleanup failed: temporary database remains'); process.exitCode = 1; }
  }
  if (backupPath) {
    try { await unlink(backupPath); }
    catch (error) { if (error?.code !== 'ENOENT') { console.error('Backup restore rehearsal cleanup failed: temporary backup remains'); process.exitCode = 1; } }
  }
}
