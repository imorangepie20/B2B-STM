CREATE TABLE login_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('email','ip')),
  scope_key text NOT NULL CHECK (scope_key ~ '^[a-f0-9]{64}$'),
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_failures_scope_time_idx ON login_failures(scope, scope_key, failed_at DESC);