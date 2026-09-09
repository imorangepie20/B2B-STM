import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPerformanceTarget,
  performanceDatabaseUrl,
  readFixtureScale,
  fixtureExpectations,
  fixtureSchemaReadinessSql,
  performanceDatabaseGrantSql,
  performanceFixtureDatabaseUrl,
} from '../lib/performance-target.mjs';

test('performance target accepts only the isolated local performance database', () => {
  assert.doesNotThrow(() => assertPerformanceTarget('postgresql://user:secret@127.0.0.1:5432/b2b_stm_perf'));
  for (const value of [
    'postgresql://user:secret@127.0.0.1:5432/b2b_stm',
    'postgresql://user:secret@127.0.0.1:5432/b2b_stm_test',
    'postgresql://user:secret@example.test:5432/b2b_stm_perf',
  ]) assert.throws(() => assertPerformanceTarget(value), /performance database/i);
});

test('performance URL keeps credentials and changes only the database name', () => {
  const source = 'postgresql://test_app:encoded%21secret@127.0.0.1:5432/b2b_stm_test?sslmode=disable';
  const result = new URL(performanceDatabaseUrl(source));
  assert.equal(result.pathname, '/b2b_stm_perf');
  assert.equal(result.username, 'test_app');
  assert.equal(result.password, 'encoded%21secret');
  assert.equal(result.searchParams.get('sslmode'), 'disable');
});

test('fixture scale supports a small rehearsal and the fixed target profile', () => {
  assert.deepEqual(readFixtureScale({ PERF_PROFILE: 'rehearsal' }), {
    profile: 'rehearsal', customers: 10, products: 100, orders: 1000, linesPerOrder: 10,
  });
  assert.deepEqual(readFixtureScale({ PERF_PROFILE: 'target' }), {
    profile: 'target', customers: 100, products: 1000, orders: 100000, linesPerOrder: 10,
  });
  assert.throws(() => readFixtureScale({ PERF_PROFILE: 'custom' }), /PERF_PROFILE/);
});

test('fixture expectations derive order line and price counts', () => {
  assert.deepEqual(
    fixtureExpectations({ profile: 'rehearsal', customers: 10, products: 100, orders: 1000, linesPerOrder: 10 }),
    { customers: 10, products: 100, orders: 1000, orderLines: 10000, customerPrices: 1000 },
  );
});

test('fixture readiness checks app-owned public tables without migration metadata access', () => {
  assert.match(fixtureSchemaReadinessSql, /public\.customers/);
  assert.match(fixtureSchemaReadinessSql, /public\.orders/);
  assert.doesNotMatch(fixtureSchemaReadinessSql, /migration_meta/);
});

test('performance database grants cover current and future app tables', () => {
  assert.match(performanceDatabaseGrantSql, /GRANT USAGE ON SCHEMA public TO b2b_stm_test_app/);
  assert.match(performanceDatabaseGrantSql, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public/);
  assert.match(performanceDatabaseGrantSql, /ALTER DEFAULT PRIVILEGES FOR ROLE b2b_stm_test_migrator/);
  assert.match(performanceDatabaseGrantSql, /ON SEQUENCES/);
});

test('fixture reset requires migration credentials and targets only performance database', () => {
  assert.throws(() => performanceFixtureDatabaseUrl({}), /TEST_MIGRATION_DATABASE_URL/);
  const value = performanceFixtureDatabaseUrl({ TEST_MIGRATION_DATABASE_URL: 'postgresql://b2b_stm_test_migrator:secret@127.0.0.1:5432/b2b_stm_test' });
  assert.equal(new URL(value).pathname, '/b2b_stm_perf');
  assert.equal(new URL(value).username, 'b2b_stm_test_migrator');
});
