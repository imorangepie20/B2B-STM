import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performanceDatabaseGrantSql, performanceDatabaseUrl } from './lib/performance-target.mjs';

assert(process.argv.includes('--confirm-create'), 'Pass --confirm-create explicitly');
assert(process.env.TEST_DATABASE_URL && process.env.TEST_MIGRATION_DATABASE_URL, 'Test database URLs are required');
performanceDatabaseUrl(process.env.TEST_DATABASE_URL);
performanceDatabaseUrl(process.env.TEST_MIGRATION_DATABASE_URL);

const container = process.env.POSTGRES_CONTAINER ?? 'property-manager-postgres';
assert.match(container, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/, 'Unsafe PostgreSQL container name');

function sql(statement, database) {
  if (database) assert.match(database, /^[a-z][a-z0-9_]{0,62}$/, 'Unsafe database name');
  const command = database
    ? `exec psql -U "$POSTGRES_USER" -d ${database} -X -A -t -v ON_ERROR_STOP=1`
    : 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -A -t -v ON_ERROR_STOP=1';
  const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', command], {
    input: statement,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Performance database provisioning failed');
  return result.stdout.trim();
}

const existing = sql("SELECT datname FROM pg_database WHERE datname='b2b_stm_perf'");
if (existing) {
  const owner = sql("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='b2b_stm_perf'");
  assert.equal(owner, 'b2b_stm_test_migrator', 'Existing performance database has an unexpected owner');
  console.log('Performance database already exists with the expected owner');
} else {
  sql(`CREATE DATABASE b2b_stm_perf OWNER b2b_stm_test_migrator;
REVOKE ALL ON DATABASE b2b_stm_perf FROM PUBLIC;
GRANT CONNECT ON DATABASE b2b_stm_perf TO b2b_stm_test_app;`);
  console.log('Created isolated b2b_stm_perf database in the existing PostgreSQL container');
}
sql(performanceDatabaseGrantSql, 'b2b_stm_perf');
console.log('Verified performance database application and default privileges');
