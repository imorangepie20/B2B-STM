import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { csrfHeaders, origin } from './helpers/csrf.mjs';
const { createApplication } = createRequire(import.meta.url)('../../apps/api/dist/application.js');
const { readConfig } = createRequire(import.meta.url)('../../apps/api/dist/config.js');

test('production requires HTTPS origin and a CSRF signing secret', () => {
  const database = new URL(process.env.TEST_DATABASE_URL);
  database.pathname = '/b2b_stm';
  const env = { DATABASE_URL: database.href, NODE_ENV: 'production' };
  assert.throws(() => readConfig(env), /APP_ORIGIN/);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'http://example.test' }), /APP_ORIGIN/);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'https://example.test' }), /CSRF_SECRET/);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'https://example.test/path', CSRF_SECRET: 'a'.repeat(64) }), /APP_ORIGIN/);
});

test('login rejects missing or foreign Origin before issuing any cookie', async () => {
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    for (const headers of [{}, { origin: 'https://evil.test' }, { origin: 'null' }]) {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ email: `${randomUUID()}@example.test`, password: 'wrong' }) });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    const response = await fetch(`${base}/api/auth/csrf`, { headers: { origin: 'https://evil.test' } });
    assert.equal(response.status, 403);
  } finally { await app.close(); }
});

test('HTTPS tunnel origin sets Secure cookies even in development mode', async () => {
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL, APP_ORIGIN: 'https://preview.example.test' });
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/api/auth/csrf`);
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie()[0];
    assert(cookie.startsWith('__Host-b2b_csrf='));
    for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert(cookie.includes(attribute));
  } finally { await app.close(); }
});

test('logout requires session-bound CSRF and revokes only the current session', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const id = randomUUID();
  const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  try {
    await db.query('INSERT INTO users(id,email,account_type) VALUES ($1,$2,$3)', [id, `${id}@example.test`, 'internal']);
    for (const token of tokens) await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '12 hours')", [createHash('sha256').update(token).digest('hex'), id]);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const session = `b2b_session=${tokens[0]}`;
    const headers = await csrfHeaders(base, session);
    const anonymous = await csrfHeaders(base);
    const post = headers => fetch(`${base}/api/auth/logout`, { method: 'POST', headers });
    for (const invalid of [
      { cookie: session, origin },
      { ...headers, 'x-csrf-token': 'forged' },
      { ...headers, 'x-csrf-token': 'forged', cookie: `${session}; b2b_csrf=forged` },
      { ...headers, origin: 'https://evil.test' },
      { ...headers, origin: 'null' },
      { ...headers, cookie: `${headers.cookie}; ${headers.cookie}` },
      { ...anonymous, cookie: `${session}; ${anonymous.cookie}` },
      { ...headers, cookie: headers.cookie.replace(tokens[0], tokens[1]) },
    ]) assert.equal((await post(invalid)).status, 403);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: session } })).status, 200);
    const response = await post(headers);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert(response.headers.getSetCookie().some(value => value.startsWith('b2b_session=;')));
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: session } })).status, 401);
    assert.equal((await post(headers)).status, 401);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: `b2b_session=${tokens[1]}` } })).status, 200);
  } finally {
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    await db.end();
    await app.close();
  }
});
