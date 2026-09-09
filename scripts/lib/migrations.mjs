import { createHash } from 'node:crypto';
import pg from 'pg';

export function assertMigrationTarget(connectionString, schema = 'migration_meta') {
  if (!/^(migration_meta|migration_test_[0-9]+)$/.test(schema)) throw new Error('Invalid migration schema');
  const target = new URL(connectionString);
  if (!['/b2b_stm', '/b2b_stm_test', '/b2b_stm_perf'].includes(target.pathname)) throw new Error('Unexpected migration database');
  if (schema !== 'migration_meta' && target.pathname !== '/b2b_stm_test') throw new Error('Test schema requires test database');
  return target;
}

export async function applyMigrations(connectionString, migrations, schema = 'migration_meta') {
  assertMigrationTarget(connectionString, schema);
  const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  const names = new Set();
  for (const file of sorted) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file.name) || names.has(file.name)) throw new Error('Invalid migration name');
    names.add(file.name);
  }
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query('SELECT pg_advisory_xact_lock(734012, 1)');
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query(`SELECT name, checksum FROM ${schema}.migrations ORDER BY name`);
    const history = new Map(rows.map(row => [row.name, row.checksum]));
    for (const row of rows) if (!names.has(row.name)) throw new Error('Previously applied migration missing');
    const applied = [];
    for (const file of sorted) {
      const checksum = createHash('sha256').update(file.sql).digest('hex');
      if (history.has(file.name)) {
        if (history.get(file.name) !== checksum) throw new Error('Applied migration checksum mismatch');
        continue;
      }
      if (rows.length && file.name < rows.at(-1).name) throw new Error('Out-of-order migration');
      await client.query(file.sql);
      await client.query(`INSERT INTO ${schema}.migrations(name, checksum) VALUES ($1, $2)`, [file.name, checksum]);
      applied.push(file.name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
}
