import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { open, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { assertBootstrapDeploymentTarget, bootstrapAdmin } from './lib/bootstrap-admin.mjs';

async function main() {
  const args = process.argv.slice(2);
  const deployment = args.length === 3 && args[0] === '--deployment' && args[1] === '--email';
  const development = args.length === 2 && args[0] === '--email';
  const email = deployment ? args[2] : args[1];
  if ((!deployment && !development) || !email) throw new Error('Usage: admin:bootstrap [--deployment] --email your@email');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run in an interactive terminal; password input is hidden');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (deployment) {
    assertBootstrapDeploymentTarget(process.env.DATABASE_URL);
    if (!/^[a-fA-F0-9]{64}$/.test(process.env.MFA_ENCRYPTION_KEY ?? '')) throw new Error('Deployment MFA_ENCRYPTION_KEY must be 32 bytes in hex');
  } else if (new URL(process.env.DATABASE_URL).pathname !== '/b2b_stm') throw new Error('Local B2B development database required');
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
    password = await secret('New password (12–128 characters): ');
    if (password !== await secret('Confirm password: ')) throw new Error('Passwords do not match');
  } finally { reader.close(); }
  if (deployment) {
    await bootstrapAdmin(process.env.DATABASE_URL, email, password);
    password = undefined;
    console.log('Initial administrator created. Restart the API, sign in, and enroll MFA before using administration endpoints.');
    return;
  }
  // A persistent key is saved before local account creation. Never replace an existing key.
  const envFile = new URL('../.env.local', import.meta.url);
  const lockPath = new URL('../.env.bootstrap.lock', import.meta.url);
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another bootstrap may be running (.env.bootstrap.lock)'); });
  try {
  const file = await open(envFile, 'r+');
  try {
    const content = await file.readFile('utf8');
    const env = parseEnv(content);
    if (env.MFA_ENCRYPTION_KEY !== undefined) {
      if (!/^[a-fA-F0-9]{64}$/.test(env.MFA_ENCRYPTION_KEY)) throw new Error('Existing MFA key is invalid; no replacement made');
    } else {
      await file.write(`\nMFA_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`);
      await file.sync();
    }
  } finally { await file.close(); }
  await bootstrapAdmin(process.env.DATABASE_URL, email, password);
  } finally { await lock.close(); await unlink(lockPath); }
  password = undefined;
  console.log('Initial administrator created. Restart the API, sign in, and enroll MFA before using administration endpoints.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
