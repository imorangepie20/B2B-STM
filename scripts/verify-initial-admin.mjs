import pg from 'pg';

const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('BOOTSTRAP_EMAIL is required');
if (new URL(process.env.DATABASE_URL).pathname !== '/b2b_stm') throw new Error('Development B2B database required');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await db.connect();
  const result = await db.query(`SELECT u.active, u.password_hash IS NOT NULL AS password_set,
    EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='system') AS system_role
    FROM users u WHERE u.email=$1`, [email]);
  const account = result.rows[0];
  if (!account?.active || !account.password_set || !account.system_role) throw new Error('Initial administrator is not ready');
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.MFA_ENCRYPTION_KEY ?? '')) throw new Error('MFA_ENCRYPTION_KEY is missing or invalid');
  console.log('Initial administrator and MFA encryption key are ready');
} finally { await db.end(); }
