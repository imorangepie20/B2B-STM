import { createHash } from 'node:crypto';
import pg from 'pg';

const email = process.env.RESET_LOGIN_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('RESET_LOGIN_EMAIL is required');
if (new URL(process.env.DATABASE_URL).pathname !== '/b2b_stm') throw new Error('Development B2B database required');

const digest = value => createHash('sha256').update(value).digest('hex');
const localIpKeys = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].map(digest);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await db.connect();
  await db.query('BEGIN');
  const result = await db.query(`DELETE FROM login_failures
    WHERE (scope='email' AND scope_key=$1)
       OR (scope='ip' AND scope_key=ANY($2::text[]))`, [digest(email), localIpKeys]);
  await db.query('COMMIT');
  console.log(`Cleared ${result.rowCount} matching login-limit record(s)`);
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await db.end();
}
