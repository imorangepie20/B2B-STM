import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import pg from 'pg';
import { csrfHeaders } from './helpers/csrf.mjs';

const scrypt = promisify(scryptCallback);
const { createApplication } = createRequire(import.meta.url)('../../apps/api/dist/application.js');

async function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

test('password login issues a replacement server session cookie', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const id = randomUUID();
  const email = `${id}@example.test`;
  const previousToken = randomBytes(32).toString('hex');
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    await db.query('INSERT INTO users(id,email,account_type,password_hash) VALUES ($1,$2,$3,$4)', [id, email, 'internal', await passwordHash('ValidPassword!23')]);
    await db.query('INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,$2,$3)', [id, 'internal', 'warehouse']);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at) VALUES ($1,$2,now()+interval '12 hours',now())", [createHash('sha256').update(previousToken).digest('hex'), id]);

    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...await csrfHeaders(base) },
      body: JSON.stringify({ email: email.toUpperCase(), password: 'ValidPassword!23' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('b2b_session='));
    assert.match(cookie, /^b2b_session=[a-f0-9]{64};/);
    for (const attribute of ['Max-Age=43200', 'Path=/', 'HttpOnly', 'SameSite=Lax']) assert(cookie.includes(attribute));
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: `b2b_session=${previousToken}` } })).status, 401);
  } finally {
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]).catch(() => {});
    await db.query('DELETE FROM user_roles WHERE user_id=$1', [id]).catch(() => {});
    await db.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
    await db.end();
    await app.close();
  }
});


test('password login blocks the sixth failure by email and independently by IP', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const id = randomUUID();
  const email = `${id}@example.test`;
  const keys = new Set();
  const { PasswordLoginService } = createRequire(import.meta.url)('../../apps/api/dist/identity/password-login.service.js');
  const login = (targetEmail, password, ip) => {
    for (const value of [targetEmail, ip]) keys.add(createHash('sha256').update(value).digest('hex'));
    return app.get(PasswordLoginService).login(targetEmail, password, ip);
  };
  const expectStatus = async (promise, status) => assert.rejects(promise, error => error.getStatus() === status);
  try {
    await db.query('INSERT INTO users(id,email,account_type,password_hash) VALUES ($1,$2,$3,$4)', [id, email, 'internal', await passwordHash('ValidPassword!23')]);
    for (let attempt = 0; attempt < 5; attempt++) await expectStatus(login(email, 'wrong', `${id}-ip-${attempt}`), 401);
    await expectStatus(login(email, 'ValidPassword!23', `${id}-new-ip`), 429);
    const ip = `${id}-shared-ip`;
    for (let attempt = 0; attempt < 5; attempt++) await expectStatus(login(`${id}-${attempt}@example.test`, 'wrong', ip), 401);
    await expectStatus(login(`${id}-fresh@example.test`, 'wrong', ip), 429);
  } finally {
    await db.query('DELETE FROM login_failures WHERE scope_key=ANY($1::text[])', [[...keys]]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]).catch(() => {});
    await db.query('DELETE FROM user_roles WHERE user_id=$1', [id]).catch(() => {});
    await db.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
    await db.end();
    await app.close();
  }
});
