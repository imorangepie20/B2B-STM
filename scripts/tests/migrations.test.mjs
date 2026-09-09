import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigrations, assertMigrationTarget } from '../lib/migrations.mjs';

test('migration target allows the isolated performance database only in its primary schema', () => {
  assert.doesNotThrow(() => assertMigrationTarget('postgresql://user:secret@127.0.0.1:5432/b2b_stm_perf', 'migration_meta'));
  assert.throws(() => assertMigrationTarget('postgresql://user:secret@127.0.0.1:5432/b2b_stm_perf', 'migration_test_1'), /schema/i);
});

test('migration repeat, checksum, rollback and concurrent runners on dedicated test DB', async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  assert.equal(new URL(url).pathname, '/b2b_stm_test');
  const schema = `migration_test_${Date.now()}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const first = [{ name: '0001_probe.sql', sql: `CREATE TABLE ${schema}.probe (id integer PRIMARY KEY);` }];
    const results = await Promise.all([applyMigrations(url, first, schema), applyMigrations(url, first, schema)]);
    assert.deepEqual(results.map(r => r.length).sort(), [0, 1]);
    assert.deepEqual(await applyMigrations(url, first, schema), []);
    await assert.rejects(applyMigrations(url, [{ ...first[0], sql: first[0].sql + '\n-- changed' }], schema), /checksum/i);
    await assert.rejects(applyMigrations(url, [], schema), /missing/i);
    await assert.rejects(applyMigrations(url, [...first, { name: '0002_failure.sql', sql: `INSERT INTO ${schema}.probe VALUES (1); SELECT 1/0;` }], schema));
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.probe`)).rows[0].count, 0);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.migrations`)).rows[0].count, 1);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
