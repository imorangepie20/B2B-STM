import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resetAdminPassword } from './lib/bootstrap-admin.mjs';

async function main() {
  const [flag, email, extra] = process.argv.slice(2);
  if (flag !== '--email' || !email || extra) throw new Error('Usage: npm.cmd run admin:reset-password -- --email your@email');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run in an interactive terminal; password input is hidden');
  if (new URL(process.env.DATABASE_URL).pathname !== '/b2b_stm') throw new Error('Local B2B development database required');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  const secret = async prompt => {
    process.stdout.write(prompt);
    muted = true;
    try { return await reader.question(''); } finally { muted = false; process.stdout.write('\n'); }
  };
  let password;
  try {
    password = await secret('New password (12 to 128 characters): ');
    if (password !== await secret('Confirm password: ')) throw new Error('Passwords do not match');
    await resetAdminPassword(process.env.DATABASE_URL, email, password);
  } finally { password = undefined; reader.close(); }
  console.log('Administrator password reset. Existing sessions were revoked; sign in again and complete MFA.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
