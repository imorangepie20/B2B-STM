import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

// Explicit local-only provisioning. Never overwrites existing roles, databases or secrets.
const container = 'property-manager-postgres';
const envPath = new URL('../.env.local', import.meta.url);
if (existsSync(envPath)) throw new Error('.env.local exists; provisioning refused');
function sql(statement, database) {
  const command = database
    ? `exec psql -U "$POSTGRES_USER" -d ${database} -At -v ON_ERROR_STOP=1`
    : 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1';
  const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', command], {
    input: statement, encoding: 'utf8',
  });
  // SQL failures may contain passwords; never echo stderr or the input statement.
  if (result.status !== 0) throw new Error('Database provisioning command failed; inspect target state before retrying');
  return result.stdout.trim();
}
const collision = sql(`SELECT datname FROM pg_database WHERE datname IN ('b2b_stm','b2b_stm_test');
SELECT rolname FROM pg_roles WHERE rolname IN ('b2b_stm_app','b2b_stm_migrator','b2b_stm_test_app','b2b_stm_test_migrator');`);
if (collision) throw new Error('Target database or role already exists; provisioning refused');

const environments = [
  { db: 'b2b_stm', app: 'b2b_stm_app', owner: 'b2b_stm_migrator', appKey: 'DATABASE_URL', ownerKey: 'MIGRATION_DATABASE_URL' },
  { db: 'b2b_stm_test', app: 'b2b_stm_test_app', owner: 'b2b_stm_test_migrator', appKey: 'TEST_DATABASE_URL', ownerKey: 'TEST_MIGRATION_DATABASE_URL' },
].map(item => ({ ...item, appPassword: randomBytes(32).toString('hex'), ownerPassword: randomBytes(32).toString('hex') }));
// Save credentials before mutation so a partial failure remains recoverable without rotation.
writeFileSync(envPath, environments.flatMap(item => [
  `${item.appKey}=postgresql://${item.app}:${item.appPassword}@127.0.0.1:5432/${item.db}`,
  `${item.ownerKey}=postgresql://${item.owner}:${item.ownerPassword}@127.0.0.1:5432/${item.db}`,
]).join('\n') + '\n', { flag: 'wx', mode: 0o600 });

for (const item of environments) {
  sql(`CREATE ROLE ${item.owner} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${item.ownerPassword}';
CREATE ROLE ${item.app} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${item.appPassword}';
CREATE DATABASE ${item.db} OWNER ${item.owner};
REVOKE ALL ON DATABASE ${item.db} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${item.db} TO ${item.app};`);
  sql(`REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ${item.app};
ALTER DEFAULT PRIVILEGES FOR ROLE ${item.owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${item.app};
ALTER DEFAULT PRIVILEGES FOR ROLE ${item.owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${item.app};`, item.db);
  console.log(`Created ${item.db} with separate migration and application roles`);
}
