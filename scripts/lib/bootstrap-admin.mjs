import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { hashPassword } = createRequire(import.meta.url)('../../apps/api/dist/identity/password.js');

export function assertBootstrapDeploymentTarget(connectionString) {
  const target = new URL(connectionString);
  assert(['postgresql:', 'postgres:'].includes(target.protocol), 'PostgreSQL URL required');
  assert.equal(target.pathname, '/b2b_stm', 'B2B production database required');
  assert.equal(target.hostname, 'postgres', 'Compose PostgreSQL service required');
  return target;
}

function validateCredentials(connectionString, email, password) {
  const target = new URL(connectionString);
  if (!['/b2b_stm', '/b2b_stm_test'].includes(target.pathname)) throw new Error('B2B database required');
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Invalid email');
  if (typeof password !== 'string' || [...password].length < 12 || [...password].length > 128 || Buffer.byteLength(password) > 512) throw new Error('Password must contain 12 to 128 characters');
}

export async function bootstrapAdmin(connectionString, email, password) {
  validateCredentials(connectionString, email, password);
  const encoded = await hashPassword(password);
  const db = new pg.Client({ connectionString });
  try {
    await db.connect();
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(734012, 2)');
    if ((await db.query("SELECT 1 FROM user_roles WHERE role='system' LIMIT 1")).rowCount) throw new Error('Administrator already exists; bootstrap refused');
    const id = randomUUID();
    await db.query("INSERT INTO users(id,email,account_type,password_hash) VALUES ($1,$2,'internal',$3)", [id, email.trim().toLowerCase(), encoded]);
    await db.query("INSERT INTO user_roles(user_id,account_type,role) VALUES ($1,'internal','system')", [id]);
    await db.query('COMMIT');
    return id;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    if (error.message === 'Administrator already exists; bootstrap refused') throw error;
    throw new Error('Administrator creation failed; existing accounts were not changed');
  } finally { await db.end(); }
}

export async function resetAdminPassword(connectionString, email, password) {
  validateCredentials(connectionString, email, password);
  const encoded = await hashPassword(password);
  const db = new pg.Client({ connectionString });
  try {
    await db.connect();
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(734012, 2)');
    const account = await db.query(`SELECT u.id FROM users u
      WHERE u.email=$1 AND u.active=true
        AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='system') FOR UPDATE`, [email.trim().toLowerCase()]);
    if (!account.rowCount) throw new Error('Active system administrator not found');
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [account.rows[0].id, encoded]);
    await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [account.rows[0].id]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    if (error.message === 'Active system administrator not found') throw error;
    throw new Error('Administrator password reset failed; existing password was not changed');
  } finally { await db.end(); }
}
