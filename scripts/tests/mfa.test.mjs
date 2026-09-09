import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { generate } from 'otplib';
import { csrfHeaders } from './helpers/csrf.mjs';
const require = createRequire(import.meta.url);
const { createApplication } = require('../../apps/api/dist/application.js');
const { hashPassword } = require('../../apps/api/dist/identity/password.js');
const digest = value => createHash('sha256').update(value).digest('hex');

test('MFA enrollment encrypts secret, verifies once and recovery codes are single-use', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL, MFA_ENCRYPTION_KEY: randomBytes(32).toString('hex') });
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const id = randomUUID();
  const password = 'A secure MFA test passphrase!';
  const sessions = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  try {
    await db.query("INSERT INTO users(id,email,account_type,password_hash) VALUES ($1,$2,'internal',$3)", [id, `${id}@example.test`, await hashPassword(password)]);
    await db.query("INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,'internal','system')", [id]);
    for (const token of sessions) await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '12 hours')", [digest(token), id]);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const headers = await Promise.all(sessions.map(token => csrfHeaders(base, `b2b_session=${token}`)));
    const post = (path, body, index = 0) => fetch(`${base}/api/auth/mfa/${path}`, { method: 'POST', headers: { ...headers[index], 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const status = () => fetch(`${base}/api/auth/mfa/status`, { headers: headers[0] });
    assert.deepEqual(await (await status()).json(), { enrolled: false });
    assert.equal((await post('enroll', { password: 'wrong' })).status, 401);
    const enrollment = await post('enroll', { password });
    assert.equal(enrollment.status, 201);
    assert.equal(enrollment.headers.get('cache-control'), 'no-store');
    const { secret, uri } = await enrollment.json();
    assert.match(uri, /^otpauth:\/\/totp\//);
    const stored = (await db.query('SELECT encrypted_secret FROM mfa_credentials WHERE user_id=$1', [id])).rows[0];
    assert(!stored.encrypted_secret.includes(secret));
    assert.equal((await fetch(`${base}/api/auth/workspaces/system`, { headers: headers[0] })).status, 403);
    const code = await generate({ secret });
    assert.equal((await post('confirm', { code }, 1)).status, 400, 'pending enrollment belongs to its session');
    const confirmed = await post('confirm', { code });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(await (await status()).json(), { enrolled: true });
    const { recoveryCodes } = await confirmed.json();
    assert.equal(recoveryCodes.length, 10);
    assert.equal(new Set(recoveryCodes).size, 10);
    const rotateCode = await generate({ secret, epoch: Math.floor(Date.now()/1000)+30 });
    const rotated = await post('recovery-codes', { password, code: rotateCode });
    assert.equal(rotated.status, 200);
    const { recoveryCodes: replacementCodes } = await rotated.json();
    assert.equal(replacementCodes.length, 10);
    assert.equal((await post('recover', { code: recoveryCodes[0] }, 1)).status, 401, 'old recovery codes are revoked');
    assert.equal((await post('recover', { code: replacementCodes[0] }, 1)).status, 200);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM mfa_events WHERE user_id=$1 AND event='recovery_codes_regenerated'", [id])).rows[0].n, 1);
    assert.equal((await fetch(`${base}/api/auth/workspaces/system`, { headers: headers[0] })).status, 200);
    assert.equal((await post('recovery-codes', { password, code: rotateCode })).status, 401, 'TOTP cannot be replayed');
    assert.equal((await post('enroll', { password })).status, 409);
    const results = await Promise.all([post('recover', { code: replacementCodes[1] }, 1), post('recover', { code: replacementCodes[1] }, 1)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
    assert.equal((await fetch(`${base}/api/auth/workspaces/system`, { headers: headers[1] })).status, 200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND consumed_at IS NOT NULL', [id])).rows[0].n, 2);
    // A credential locked by failed verification cannot be bypassed by starting enrollment again.
    await db.query("UPDATE mfa_credentials SET failed_attempts=5, locked_until=now()+interval '15 minutes' WHERE user_id=$1", [id]);
    assert.equal((await post('recover', { code: replacementCodes[2] }, 1)).status, 429);
    await db.query('UPDATE mfa_credentials SET failed_attempts=0,locked_until=NULL WHERE user_id=$1', [id]);
    for (let attempt=0; attempt<5; attempt++) assert.equal((await post('verify', { code: 'invalid' }, 1)).status, 401);
    assert.equal((await post('recover', { code: replacementCodes[2] }, 1)).status, 429);
  } finally {
    for (const table of ['mfa_recovery_codes','mfa_credentials','mfa_events']) {
      if ((await db.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [id]);
    }
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await db.query('DELETE FROM user_roles WHERE user_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    await db.end();
    await app.close();
  }
});

test('system administrator can reset another enrolled MFA device exactly once', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL, MFA_ENCRYPTION_KEY: randomBytes(32).toString('hex') });
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const actorId = randomUUID(), targetId = randomUUID(), actorToken = randomBytes(32).toString('hex'), targetToken = randomBytes(32).toString('hex');
  const requestId = randomUUID();
  try {
    for (const [id, email] of [[actorId, 'mfa-reset-admin@example.test'], [targetId, 'mfa-reset-target@example.test']]) {
      await db.query("INSERT INTO users(id,email,account_type,password_hash) VALUES ($1,$2,'internal',$3)", [id, email, await hashPassword('A secure MFA reset passphrase!')]);
      await db.query("INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,'internal','system')", [id]);
      await db.query("INSERT INTO mfa_credentials(user_id,encrypted_secret,confirmed_at,last_time_step,failed_attempts,locked_until) VALUES ($1,'sealed',now(),42,3,now()+interval '15 minutes')", [id]);
    }
    await db.query('INSERT INTO sessions(token_hash,user_id,expires_at,mfa_verified_at) VALUES ($1,$2,now()+interval \'12 hours\',now()),($3,$4,now()+interval \'12 hours\',now())', [digest(actorToken), actorId, digest(targetToken), targetId]);
    await db.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES ($1,$2)', [targetId, digest(randomBytes(16).toString('hex'))]);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const headers = await csrfHeaders(base, `b2b_session=${actorToken}`);
    const reset = () => fetch(`${base}/api/auth/users/${targetId}/mfa-reset`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ requestId, reason: '분실한 인증 기기 교체 승인' }) });
    const first = await reset();
    assert.equal(first.status, 201);
    assert.deepEqual(await first.json(), { userId: targetId, status: 'mfa_reset' });
    assert.deepEqual(await (await reset()).json(), { userId: targetId, status: 'mfa_reset' });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL', [targetId])).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1', [targetId])).rows[0].n, 0);
    assert.deepEqual((await db.query('SELECT encrypted_secret,confirmed_at,last_time_step,failed_attempts,locked_until FROM mfa_credentials WHERE user_id=$1', [targetId])).rows[0], { encrypted_secret: null, confirmed_at: null, last_time_step: null, failed_attempts: 0, locked_until: null });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM mfa_device_resets WHERE user_id=$1', [targetId])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM mfa_events WHERE user_id=$1 AND event='reset'", [targetId])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM identity_events WHERE user_id=$1 AND actor_id=$2 AND event='mfa_reset'", [targetId, actorId])).rows[0].n, 1);
  } finally {
    for (const table of ['mfa_device_resets','mfa_recovery_codes','mfa_credentials','mfa_events','identity_events','command_results','sessions','user_roles','users']) {
      if ((await db.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) {
        const column = table === 'command_results' ? 'actor_id' : table === 'users' ? 'id' : 'user_id';
        await db.query(`DELETE FROM ${table} WHERE ${column}=$1 OR ${column}=$2`, [actorId, targetId]).catch(() => {});
      }
    }
    await db.end();
    await app.close();
  }
});
