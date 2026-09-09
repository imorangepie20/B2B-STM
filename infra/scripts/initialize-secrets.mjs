import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access, mkdir, chmod, writeFile } from 'node:fs/promises';

assert(process.argv[2] === '--confirm-new-b2b-stm', 'Explicit initialization confirmation required');
assert(process.platform === 'linux', 'Run on the deployment host');
const directory = new URL('../secrets/', import.meta.url);
const names = ['compose', 'database', 'migration', 'api', 'web', 'tunnel'];
for (const name of names) {
  const exists = await access(new URL(`${name}.env`, directory)).then(() => true, e => {
    if (e.code === 'ENOENT') return false;
    throw e;
  });
  assert(!exists, 'Refusing to overwrite existing deployment secrets');
}
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const runtime = new URL('../runtime/', import.meta.url);
await mkdir(runtime, { recursive: true, mode: 0o700 });
await chmod(runtime, 0o700);
const random = () => randomBytes(32).toString('hex');
const owner = random(), app = random();
const files = {
  compose: 'COMPOSE_PROJECT_NAME=b2b-stm\nAPP_VERSION=local\n',
  database: `POSTGRES_DB=b2b_stm\nPOSTGRES_USER=b2b_stm_migrator\nPOSTGRES_PASSWORD=${owner}\nB2B_APP_USER=b2b_stm_app\nB2B_APP_PASSWORD=${app}\n`,
  migration: `MIGRATION_DATABASE_URL=postgresql://b2b_stm_migrator:${owner}@postgres:5432/b2b_stm\n`,
  api: `NODE_ENV=production\nAPI_HOST=0.0.0.0\nAPI_PORT=3200\nAPP_ORIGIN=https://stm.approid.team\nDATABASE_URL=postgresql://b2b_stm_app:${app}@postgres:5432/b2b_stm\nCSRF_SECRET=${random()}\nMFA_ENCRYPTION_KEY=${random()}\nMAIL_TRANSPORT=disabled\nNOTIFICATION_WORKER_ENABLED=false\nATTACHMENT_SCAN_MODE=clamav\nCLAMAV_HOST=clamav\nCLAMAV_PORT=3310\nCLAMAV_TIMEOUT_MS=10000\n`,
  web: 'NODE_ENV=production\nAPI_BACKEND_ORIGIN=http://api:3200\n',
  tunnel: 'TUNNEL_TOKEN=\n',
};
for (const [name, data] of Object.entries(files)) {
  await writeFile(new URL(`${name}.env`, directory), data, { flag: 'wx', mode: 0o600 });
}
console.log('B2B deployment secrets created. Mail disabled; tunnel token still required.');
