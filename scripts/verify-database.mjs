import assert from 'node:assert/strict';
import pg from 'pg';

const configurations = [
  ['DATABASE_URL', 'b2b_stm', false],
  ['MIGRATION_DATABASE_URL', 'b2b_stm', true],
  ['TEST_DATABASE_URL', 'b2b_stm_test', false],
  ['TEST_MIGRATION_DATABASE_URL', 'b2b_stm_test', true],
];

for (const [key, database, canCreate] of configurations) {
  assert(process.env[key], `${key} is required`);
  const client = new pg.Client({ connectionString: process.env[key] });
  try {
    await client.connect();
    const { rows: [row] } = await client.query(`
      SELECT current_database() AS db,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
        rolsuper, rolcreatedb, rolcreaterole
      FROM pg_roles WHERE rolname = current_user`);
    assert.equal(row.db, database);
    assert.equal(row.can_create, canCreate);
    assert.equal(row.rolsuper, false);
    assert.equal(row.rolcreatedb, false);
    assert.equal(row.rolcreaterole, false);
    await client.query('BEGIN');
    if (!canCreate) {
      await assert.rejects(client.query('CREATE TABLE public.permission_probe (id integer)'), { code: '42501' });
    } else {
      await client.query('CREATE TABLE public.permission_probe (id integer)');
    }
    await client.query('ROLLBACK');
    console.log(`${key}: database and role permissions verified`);
  } finally { await client.end(); }

  const other = new URL(process.env[key]);
  other.pathname = database === 'b2b_stm' ? '/b2b_stm_test' : '/b2b_stm';
  const deniedClient = new pg.Client({ connectionString: other.toString() });
  try {
    await assert.rejects(deniedClient.connect(), { code: '42501' });
    console.log(`${key}: cross-environment connection denied`);
  } finally { await deniedClient.end(); }
}
