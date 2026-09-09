import assert from 'node:assert/strict';

export function assertPerformanceTarget(connectionString) {
  const target = new URL(connectionString);
  assert(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL performance database required');
  assert(['127.0.0.1', 'localhost'].includes(target.hostname), 'Local performance database required');
  assert.equal(target.pathname, '/b2b_stm_perf', 'Isolated performance database required');
  return target;
}

export function performanceDatabaseUrl(sourceConnectionString) {
  const target = new URL(sourceConnectionString);
  assert(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL URL required');
  assert(['127.0.0.1', 'localhost'].includes(target.hostname), 'Local PostgreSQL host required');
  assert.equal(target.pathname, '/b2b_stm_test', 'Test database credentials required');
  target.pathname = '/b2b_stm_perf';
  return target.toString();
}

export function performanceFixtureDatabaseUrl(environment = process.env) {
  assert(environment.TEST_MIGRATION_DATABASE_URL, 'TEST_MIGRATION_DATABASE_URL is required');
  return performanceDatabaseUrl(environment.TEST_MIGRATION_DATABASE_URL);
}

const profiles = {
  rehearsal: { profile: 'rehearsal', customers: 10, products: 100, orders: 1000, linesPerOrder: 10 },
  target: { profile: 'target', customers: 100, products: 1000, orders: 100000, linesPerOrder: 10 },
};

export function readFixtureScale(environment = process.env) {
  const profile = environment.PERF_PROFILE ?? 'rehearsal';
  assert(profile in profiles, 'PERF_PROFILE must be rehearsal or target');
  return { ...profiles[profile] };
}

export function fixtureExpectations(scale) {
  return {
    customers: scale.customers,
    products: scale.products,
    orders: scale.orders,
    orderLines: scale.orders * scale.linesPerOrder,
    customerPrices: scale.customers * scale.products,
  };
}

export const fixtureSchemaReadinessSql = `SELECT
  to_regclass('public.customers') IS NOT NULL
  AND to_regclass('public.products') IS NOT NULL
  AND to_regclass('public.orders') IS NOT NULL
  AND to_regclass('public.order_lines') IS NOT NULL AS ready`;

export const performanceDatabaseGrantSql = `REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO b2b_stm_test_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO b2b_stm_test_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO b2b_stm_test_app;
ALTER DEFAULT PRIVILEGES FOR ROLE b2b_stm_test_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO b2b_stm_test_app;
ALTER DEFAULT PRIVILEGES FOR ROLE b2b_stm_test_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO b2b_stm_test_app;`;
