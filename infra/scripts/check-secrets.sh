#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SECRETS_DIR=${1:-"$SCRIPT_DIR/../secrets"}

fail() {
  echo "secret preflight failed: $1" >&2
  exit 1
}

require_mode() {
  path=$1
  expected=$2
  actual=$(stat -c '%a' "$path")
  [ "$actual" = "$expected" ] || fail "$path must have mode $expected (found $actual)"
}

require_key() {
  file=$1
  key=$2
  grep -Eq "^${key}=.+" "$file" || fail "$(basename "$file") is missing $key"
  grep -Eq "^${key}=REPLACE_" "$file" && fail "$(basename "$file") still contains a placeholder for $key"
  return 0
}

[ -d "$SECRETS_DIR" ] || fail "secret directory does not exist"
require_mode "$SECRETS_DIR" 700

for name in compose database migration api web tunnel; do
  file="$SECRETS_DIR/$name.env"
  [ -f "$file" ] || fail "$name.env does not exist"
  require_mode "$file" 600
  grep -q 'REPLACE_' "$file" && fail "$name.env still contains a placeholder"
done

require_key "$SECRETS_DIR/compose.env" COMPOSE_PROJECT_NAME
require_key "$SECRETS_DIR/compose.env" APP_VERSION
require_key "$SECRETS_DIR/database.env" POSTGRES_DB
require_key "$SECRETS_DIR/database.env" POSTGRES_USER
require_key "$SECRETS_DIR/database.env" POSTGRES_PASSWORD
require_key "$SECRETS_DIR/database.env" B2B_APP_USER
require_key "$SECRETS_DIR/database.env" B2B_APP_PASSWORD
require_key "$SECRETS_DIR/migration.env" MIGRATION_DATABASE_URL
require_key "$SECRETS_DIR/api.env" DATABASE_URL
require_key "$SECRETS_DIR/api.env" CSRF_SECRET
require_key "$SECRETS_DIR/api.env" MFA_ENCRYPTION_KEY
if ! grep -Fxq 'MAIL_TRANSPORT=disabled' "$SECRETS_DIR/api.env"; then
  require_key "$SECRETS_DIR/api.env" SMTP_URL
  require_key "$SECRETS_DIR/api.env" MAIL_FROM
fi
require_key "$SECRETS_DIR/web.env" API_BACKEND_ORIGIN
require_key "$SECRETS_DIR/tunnel.env" TUNNEL_TOKEN

grep -Fxq 'COMPOSE_PROJECT_NAME=b2b-stm' "$SECRETS_DIR/compose.env" || fail "COMPOSE_PROJECT_NAME must be b2b-stm"
grep -Fxq 'POSTGRES_DB=b2b_stm' "$SECRETS_DIR/database.env" || fail "POSTGRES_DB must be b2b_stm"
grep -Fxq 'POSTGRES_USER=b2b_stm_migrator' "$SECRETS_DIR/database.env" || fail "POSTGRES_USER must be b2b_stm_migrator"
grep -Fxq 'B2B_APP_USER=b2b_stm_app' "$SECRETS_DIR/database.env" || fail "B2B_APP_USER must be b2b_stm_app"
grep -Fxq 'NODE_ENV=production' "$SECRETS_DIR/api.env" || fail "NODE_ENV must be production"
grep -Fxq 'APP_ORIGIN=https://stm.approid.team' "$SECRETS_DIR/api.env" || fail "APP_ORIGIN must be the production origin"
grep -Fxq 'ATTACHMENT_SCAN_MODE=clamav' "$SECRETS_DIR/api.env" || fail "attachment scanning must use clamav"
grep -Fxq 'CLAMAV_HOST=clamav' "$SECRETS_DIR/api.env" || fail "CLAMAV_HOST must be clamav"
grep -Fxq 'API_BACKEND_ORIGIN=http://api:3200' "$SECRETS_DIR/web.env" || fail "API_BACKEND_ORIGIN must target the API service"
grep -Eq '^DATABASE_URL=postgres(ql)?://[^@]+@postgres:5432/b2b_stm$' "$SECRETS_DIR/api.env" || fail "DATABASE_URL must target postgres/b2b_stm"
grep -Eq '^MIGRATION_DATABASE_URL=postgres(ql)?://[^@]+@postgres:5432/b2b_stm$' "$SECRETS_DIR/migration.env" || fail "MIGRATION_DATABASE_URL must target postgres/b2b_stm"
grep -Eq '^CSRF_SECRET=[0-9a-fA-F]{64,}$' "$SECRETS_DIR/api.env" || fail "CSRF_SECRET must be at least 64 hex characters"
grep -Eq '^MFA_ENCRYPTION_KEY=[0-9a-fA-F]{64}$' "$SECRETS_DIR/api.env" || fail "MFA_ENCRYPTION_KEY must be exactly 64 hex characters"

echo "secret preflight passed"
