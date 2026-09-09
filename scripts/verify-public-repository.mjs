import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const requiredIgnored = [
  '.env.local',
  '.demo-credentials.json',
  'SDTPL_ADM',
  'theme-preview',
  '.logs',
  'api.stdout.log',
  'docs/screenshots/recent-pages/admin-accounts-desktop.png',
];

for (const target of requiredIgnored) {
  const result = execFileSync('git', ['check-ignore', '--no-index', target], { encoding: 'utf8' }).trim();
  assert(result, `${target} must be excluded from Git`);
}

const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.woff2', '.ico', '.pdf']);
const forbiddenText = [
  { pattern: /jowoosung@gmail\.com/i, label: 'personal administrator email' },
];
const sensitiveKeys = new Set([
  'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL',
  'MFA_ENCRYPTION_KEY', 'CSRF_SECRET', 'SMTP_URL',
]);
const localEnvironment = await readFile('.env.local', 'utf8').catch(() => '');
const localSecrets = localEnvironment
  .split(/\r?\n/)
  .map(line => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
  .filter(match => match && sensitiveKeys.has(match[1]) && match[2].length >= 16)
  .map(match => ({ key: match[1], value: match[2] }));
const violations = [];

for (const file of candidates) {
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;
  const content = await readFile(file, 'utf8').catch(() => null);
  if (content === null) continue;
  for (const check of forbiddenText) {
    if (check.pattern.test(content)) violations.push(`${file}: ${check.label}`);
  }
  for (const secret of localSecrets) {
    if (content.includes(secret.value)) violations.push(`${file}: copied local ${secret.key} value`);
  }
}

assert.deepEqual(violations, [], `Public repository violations:\n${violations.join('\n')}`);
console.log(`Public repository verification passed: ${requiredIgnored.length} exclusions, ${candidates.length} publishable paths scanned`);
