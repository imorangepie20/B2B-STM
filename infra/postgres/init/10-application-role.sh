#!/bin/sh
set -eu

if [ "${POSTGRES_DB}" != "b2b_stm" ] || [ "${POSTGRES_USER}" != "b2b_stm_migrator" ]; then
  echo "Refusing to initialize unexpected B2B STM database or migrator role" >&2
  exit 1
fi

if [ "${B2B_APP_USER:-}" != "b2b_stm_app" ] || [ -z "${B2B_APP_PASSWORD:-}" ]; then
  echo "B2B_APP_USER=b2b_stm_app and B2B_APP_PASSWORD are required" >&2
  exit 1
fi

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$B2B_APP_PASSWORD" <<'SQL'
REVOKE ALL ON DATABASE b2b_stm FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE ROLE b2b_stm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'app_password';
-- Historical migration 0005 also grants this role; it must never allow login here.
CREATE ROLE b2b_stm_test_app NOLOGIN;
GRANT CONNECT ON DATABASE b2b_stm TO b2b_stm_app;
GRANT USAGE ON SCHEMA public TO b2b_stm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO b2b_stm_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO b2b_stm_app;

ALTER DEFAULT PRIVILEGES FOR ROLE b2b_stm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO b2b_stm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE b2b_stm_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO b2b_stm_app;
SQL
