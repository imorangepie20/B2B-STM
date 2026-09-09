import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
const { createApplication } = createRequire(import.meta.url)('../../apps/api/dist/application.js');

test('session HTTP boundary: deny anonymous, role withdrawal, blocked user and expiration', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
    await db.query('INSERT INTO users(id,email,account_type) VALUES ($1,$2,$3)', [id, `${id}@example.test`, 'internal']);
    await db.query('INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,$2,$3)', [id, 'internal', 'warehouse']);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at) VALUES ($1,$2,now()+interval '12 hours',now())", [createHash('sha256').update(token).digest('hex'), id]);
    const get = path => fetch(`${base}${path}`, { headers: { cookie: `b2b_session=${token}` } });
    const me = await get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).roles, ['warehouse']);
    assert.equal((await get('/api/auth/workspaces/warehouse')).status, 200);
    assert.equal((await get('/api/auth/workspaces/settlement')).status, 403);
    await db.query('INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,$2,$3)', [id, 'internal', 'settlement']);
    assert.equal((await get('/api/auth/workspaces/settlement')).status, 403);
    await db.query('UPDATE sessions SET mfa_verified_at=now() WHERE user_id=$1', [id]);
    assert.equal((await get('/api/auth/workspaces/settlement')).status, 200);
    await db.query('DELETE FROM user_roles WHERE user_id=$1', [id]);
    assert.equal((await get('/api/auth/workspaces/warehouse')).status, 403);
    await db.query('UPDATE users SET active=false WHERE id=$1', [id]);
    assert.equal((await get('/api/auth/me')).status, 401);
    await db.query('UPDATE users SET active=true WHERE id=$1', [id]);
    await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [id]);
    assert.equal((await get('/api/auth/me')).status, 401);
    await db.query('UPDATE sessions SET revoked_at=NULL WHERE user_id=$1', [id]);
    await db.query("UPDATE sessions SET last_seen_at=now()-interval '3 hours' WHERE user_id=$1", [id]);
    assert.equal((await get('/api/auth/me')).status, 401);
    await db.query("UPDATE sessions SET last_seen_at=now(), expires_at=now()-interval '1 minute' WHERE user_id=$1", [id]);
    assert.equal((await get('/api/auth/me')).status, 401);
    const duplicate = await fetch(`${base}/api/auth/me`, { headers: { cookie: `b2b_session=${token}; b2b_session=${token}` } });
    assert.equal(duplicate.status, 401);
    await assert.rejects(db.query('INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,$2,$3)', [id, 'internal', 'customer']), { code: '23514' });
  } finally {
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]).catch(() => {});
    await db.query('DELETE FROM user_roles WHERE user_id=$1', [id]).catch(() => {});
    await db.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
    await db.end();
    await app.close();
  }
});
