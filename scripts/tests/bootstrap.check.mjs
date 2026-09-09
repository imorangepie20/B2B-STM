import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

test('bootstrap creates exactly one administrator, and password reset is explicit', async () => {
  const module = await import('../lib/bootstrap-admin.mjs').catch(() => ({}));
  assert.equal(typeof module.bootstrapAdmin, 'function');
  assert.equal(typeof module.resetAdminPassword, 'function');
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const email = `${randomUUID()}@example.test`;
  try {
    assert.equal((await db.query("SELECT count(*)::int n FROM user_roles WHERE role='system'")).rows[0].n, 0, 'run separately from foundation tests');
    const args = [process.env.TEST_DATABASE_URL, email, 'A bootstrap test password 2026!'];
    const result = await Promise.allSettled([module.bootstrapAdmin(...args), module.bootstrapAdmin(...args)]);
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    const account = (await db.query('SELECT id,password_hash FROM users WHERE email=$1', [email])).rows[0];
    assert.match(account.password_hash, /^\$argon2id\$/);
    assert.equal((await db.query("SELECT count(*)::int n FROM user_roles WHERE user_id=$1 AND role='system'", [account.id])).rows[0].n, 1);
    await assert.rejects(module.bootstrapAdmin(...args));
    assert.equal((await db.query('SELECT password_hash FROM users WHERE email=$1', [email])).rows[0].password_hash, account.password_hash);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [createHash('sha256').update(`reset-test-session-${account.id}`).digest('hex'), account.id]);
    await module.resetAdminPassword(process.env.TEST_DATABASE_URL, email, 'A replacement test password 2026!');
    const reset = (await db.query('SELECT password_hash FROM users WHERE id=$1', [account.id])).rows[0];
    assert.notEqual(reset.password_hash, account.password_hash);
    assert.equal((await db.query("SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND revoked_at IS NOT NULL", [account.id])).rows[0].n, 1);
  } finally {
    await db.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [email]);
    await db.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [email]);
    await db.query('DELETE FROM users WHERE email=$1', [email]);
    await db.end();
  }
});
