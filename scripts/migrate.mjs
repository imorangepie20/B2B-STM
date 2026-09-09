import { readdir, readFile } from 'node:fs/promises';
import { applyMigrations } from './lib/migrations.mjs';
import { performanceDatabaseUrl } from './lib/performance-target.mjs';

try {
  const mode = process.argv[2];
  if (!['--development', '--test', '--performance'].includes(mode)) throw new Error('Select --development, --test or --performance explicitly');
  const key = mode === '--test' ? 'TEST_MIGRATION_DATABASE_URL' : mode === '--performance' ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
  if (!process.env[key]) throw new Error(`${key} is required`);
  const source = mode === '--performance' ? performanceDatabaseUrl(process.env[key]) : process.env[key];
  const expected = mode === '--test' ? '/b2b_stm_test' : mode === '--performance' ? '/b2b_stm_perf' : '/b2b_stm';
  if (new URL(source).pathname !== expected) throw new Error('Target database mismatch');
  const directory = new URL('../apps/api/db/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql'));
  const migrations = await Promise.all(files.map(async name => ({ name, sql: await readFile(new URL(name, directory), 'utf8') })));
  const applied = await applyMigrations(source, migrations);
  console.log(`Migration complete: ${applied.length} applied`);
  for (const name of applied) console.log(name);
} catch (error) {
  // Database errors may include statement contents; do not echo them to shared logs.
  console.error('Migration failed. Verify explicit target, credentials and migration integrity.');
  process.exitCode = 1;
}
