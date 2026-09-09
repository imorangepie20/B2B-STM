import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { csrfHeaders } from './helpers/csrf.mjs';
const { createApplication } = createRequire(import.meta.url)('../../apps/api/dist/application.js');
const digest = token => createHash('sha256').update(token).digest('hex');
const password = 'A long test passphrase 2026!';

async function fixture(run) {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL, MAIL_TRANSPORT: 'json', MAIL_FROM: 'STM <no-reply@example.test>' });
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const admin = randomUUID();
  const prefix = randomUUID();
  const session = randomBytes(32).toString('hex');
  try {
    await db.query("INSERT INTO users(id,email,account_type) VALUES ($1,$2,'internal')", [admin, `${prefix}-admin@example.test`]);
    await db.query("INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,'internal','system')", [admin]);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,mfa_verified_at) VALUES ($1,$2,now()+interval '12 hours',now())", [digest(session), admin]);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const adminHeaders = await csrfHeaders(base, `b2b_session=${session}`);
    const publicHeaders = await csrfHeaders(base);
    const post = (path, body, authenticated = true) => fetch(`${base}/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? adminHeaders : publicHeaders) }, body: JSON.stringify(body),
    });
    const get = path => fetch(`${base}/api/auth/${path}`, { headers: adminHeaders });
    await run({ db, base, admin, prefix, post, get, app });
  } finally {
    const ids = (await db.query('SELECT id FROM users WHERE email LIKE $1', [`${prefix}%`])).rows.map(row => row.id);
    for (const table of ['account_email_deliveries', 'account_status_changes', 'identity_events', 'account_tokens']) {
      if ((await db.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) {
        await db.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [ids]);
      }
    }
    await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await db.end();
    await app.close();
  }
}

const inviteBody = prefix => ({ email: `${prefix}-new@example.test`, accountType: 'internal', roles: ['warehouse'] });

test('login waits for password changes and cannot issue a session with the old password', () => fixture(async ({ db, prefix, post, app }) => {
  const response = await post('invitations', inviteBody(prefix));
  assert.equal(response.status, 201);
  const issued = await response.json();
  assert.equal((await post('invitations/accept', { token: issued.token, password }, false)).status, 200);
  const { PasswordLoginService } = createRequire(import.meta.url)('../../apps/api/dist/identity/password-login.service.js');
  const { hashPassword } = createRequire(import.meta.url)('../../apps/api/dist/identity/password.js');
  const replacementHash = await hashPassword('Replacement test passphrase 2026!');
  const ip = `${prefix}-race`;
  await db.query('BEGIN');
  try {
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [replacementHash, issued.userId]);
    const pending = app.get(PasswordLoginService).login(inviteBody(prefix).email, password, ip)
      .then(() => 'issued', error => error.getStatus());
    const early = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('waiting'), 500))]);
    await db.query('COMMIT');
    const result = await pending;
    assert.equal(early, 'waiting', 'login must wait for the account row lock');
    assert.equal(result, 401);
  } finally {
    await db.query('ROLLBACK');
    await db.query('DELETE FROM login_failures WHERE scope_key=ANY($1::text[])', [[digest(ip), digest(inviteBody(prefix).email)]]);
  }
}));

test('only system administrators with MFA can issue account tokens', () => fixture(async ({ db, admin, prefix, post }) => {
  await db.query('UPDATE sessions SET mfa_verified_at=NULL WHERE user_id=$1', [admin]);
  assert.equal((await post('invitations', inviteBody(prefix))).status, 403);
  await db.query('UPDATE sessions SET mfa_verified_at=now() WHERE user_id=$1', [admin]);
  await db.query("UPDATE user_roles SET role='warehouse' WHERE user_id=$1", [admin]);
  assert.equal((await post('invitations', inviteBody(prefix))).status, 403);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users WHERE email=$1', [inviteBody(prefix).email])).rows[0].n, 0);
}));

test('customer invitations preserve membership and reject inactive customers', () => fixture(async ({ db, prefix, post, base }) => {
  const customerId = randomUUID();
  await db.query('INSERT INTO customers(id,code,name) VALUES ($1,$2,$3)', [customerId, prefix, 'Test customer']);
  try {
    const body = { email: `${prefix}-customer@example.test`, accountType: 'customer', customerId, roles: ['customer'] };
    assert.equal((await post('invitations', { ...body, roles: ['system'] })).status, 400);
    await db.query('UPDATE customers SET active=false WHERE id=$1', [customerId]);
    assert.equal((await post('invitations', body)).status, 400);
    await db.query('UPDATE customers SET active=true WHERE id=$1', [customerId]);
    const response = await post('invitations', body);
    assert.equal(response.status, 201);
    const issued = await response.json();
    assert.equal((await post('invitations/accept', { token: issued.token, password }, false)).status, 200);
    const login = await post('login', { email: body.email, password }, false);
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().find(value => value.startsWith('b2b_session=')).split(';')[0];
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
    assert.equal(me.customerId, customerId);
    assert.deepEqual(me.roles, ['customer']);
  } finally {
    // Remove fixture users before their customer FK target; outer cleanup owns the admin.
    const ids = (await db.query('SELECT id FROM users WHERE customer_id=$1', [customerId])).rows.map(row => row.id);
    for (const table of ['account_email_deliveries', 'identity_events', 'account_tokens', 'sessions', 'user_roles']) await db.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [ids]);
    await db.query('DELETE FROM users WHERE customer_id=$1', [customerId]);
    await db.query('DELETE FROM customers WHERE id=$1', [customerId]);
  }
}));

test('invitation creates scoped account and can be accepted only once under concurrency', () => fixture(async ({ db, prefix, post }) => {
  assert.equal((await post('invitations', { ...inviteBody(prefix), roles: ['customer'] })).status, 400);
  const response = await post('invitations', inviteBody(prefix));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const issued = await response.json();
  assert.match(issued.token, /^[a-f0-9]{64}$/);
  assert.equal(issued.delivery.status, 'sent');
  assert.deepEqual((await db.query('SELECT recipient,purpose,status FROM account_email_deliveries WHERE user_id=$1', [issued.userId])).rows[0], { recipient: inviteBody(prefix).email, purpose: 'invitation', status: 'sent' });
  const row = (await db.query('SELECT token_hash, extract(epoch FROM (expires_at-created_at))::int AS ttl FROM account_tokens WHERE user_id=$1', [issued.userId])).rows[0];
  assert.equal(row.token_hash, digest(issued.token));
  assert.equal(row.ttl, 86400);
  assert.equal((await post('invitations', inviteBody(prefix))).status, 409);
  assert.equal((await post('password-reset/complete', { token: issued.token, password }, false)).status, 400);
  assert.equal((await post('invitations/accept', { token: issued.token, password: 'short' }, false)).status, 400);
  const responses = await Promise.all([post('invitations/accept', { token: issued.token, password }, false), post('invitations/accept', { token: issued.token, password }, false)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  const stored = (await db.query('SELECT password_hash FROM users WHERE id=$1', [issued.userId])).rows[0].password_hash;
  assert.match(stored, /^\$argon2id\$/);
  const login = await post('login', { email: inviteBody(prefix).email, password }, false);
  assert.equal(login.status, 200);
  assert.equal((await post(`users/${issued.userId}/invitation`, {})).status, 409);
  const events = (await db.query('SELECT event FROM identity_events WHERE user_id=$1 ORDER BY id', [issued.userId])).rows.map(r => r.event);
  assert.deepEqual(events, ['invitation_issued', 'invitation_accepted']);
}));

test('reissue invalidates old token; reset expires and revokes sessions on completion', () => fixture(async ({ db, prefix, post }) => {
  const response = await post('invitations', inviteBody(prefix));
  assert.equal(response.status, 201);
  const first = await response.json();
  const reissued = await post(`users/${first.userId}/invitation`, {});
  assert.equal(reissued.status, 201);
  const second = await reissued.json();
  assert.equal((await post('invitations/accept', { token: first.token, password }, false)).status, 400);
  assert.equal((await post('invitations/accept', { token: second.token, password }, false)).status, 200);
  const login = await post('login', { email: inviteBody(prefix).email, password }, false);
  assert.equal(login.status, 200);
  const reset = await post(`users/${first.userId}/password-reset`, {});
  assert.equal(reset.status, 201);
  const expired = await reset.json();
  assert.equal((await db.query('SELECT extract(epoch FROM (expires_at-created_at))::int AS ttl FROM account_tokens WHERE token_hash=$1', [digest(expired.token)])).rows[0].ttl, 1800);
  await db.query("UPDATE account_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [digest(expired.token)]);
  assert.equal((await post('password-reset/complete', { token: expired.token, password }, false)).status, 400);
  const replacement = await (await post(`users/${first.userId}/password-reset`, {})).json();
  await db.query('UPDATE users SET active=false WHERE id=$1', [first.userId]);
  assert.equal((await post('password-reset/complete', { token: replacement.token, password }, false)).status, 400);
  await db.query('UPDATE users SET active=true WHERE id=$1', [first.userId]);
  const resetPassword = 'A different long passphrase 2026!';
  const done = await Promise.all([post('password-reset/complete', { token: replacement.token, password: resetPassword }, false), post('password-reset/complete', { token: replacement.token, password: resetPassword }, false)]);
  assert.deepEqual(done.map(r => r.status).sort(), [200, 400]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL', [first.userId])).rows[0].n, 0);
  assert.equal((await post('login', { email: inviteBody(prefix).email, password: resetPassword }, false)).status, 200);
}));

test('system administrator lists accounts and records activation changes', () => fixture(async ({ db, admin, prefix, post, get }) => {
  const invitation = await post('invitations', inviteBody(prefix));
  assert.equal(invitation.status, 201);
  const issued = await invitation.json();

  const listed = await get('users');
  assert.equal(listed.status, 200);
  const accounts = await listed.json();
  const account = accounts.find(value => value.id === issued.userId);
  assert.deepEqual({
    email: account.email,
    accountType: account.accountType,
    roles: account.roles,
    active: account.active,
    passwordConfigured: account.passwordConfigured,
    invitationPending: account.invitationPending,
  }, {
    email: inviteBody(prefix).email,
    accountType: 'internal',
    roles: ['warehouse'],
    active: true,
    passwordConfigured: false,
    invitationPending: true,
  });

  const deactivated = await post(`users/${issued.userId}/status`, { active: false, reason: '담당자 퇴사에 따른 계정 회수' });
  assert.equal(deactivated.status, 200);
  assert.equal((await db.query('SELECT active FROM users WHERE id=$1', [issued.userId])).rows[0].active, false);
  assert.equal((await post(`users/${issued.userId}/invitation`, {})).status, 404);

  const activated = await post(`users/${issued.userId}/status`, { active: true, reason: '재입사 승인에 따른 계정 복구' });
  assert.equal(activated.status, 200);
  const changes = (await db.query('SELECT active,reason FROM account_status_changes WHERE user_id=$1 ORDER BY created_at,id', [issued.userId])).rows;
  assert.deepEqual(changes, [
    { active: false, reason: '담당자 퇴사에 따른 계정 회수' },
    { active: true, reason: '재입사 승인에 따른 계정 복구' },
  ]);

  assert.equal((await post(`users/${admin}/status`, { active: false, reason: '자기 계정 비활성화 시도' })).status, 409);
}));
