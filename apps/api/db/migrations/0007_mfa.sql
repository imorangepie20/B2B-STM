CREATE TABLE mfa_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  encrypted_secret text,
  enrollment_session_hash text,
  enrollment_expires_at timestamptz,
  confirmed_at timestamptz,
  last_time_step bigint,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts>=0),
  locked_until timestamptz
);
CREATE TABLE mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz,
  PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE mfa_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  event text NOT NULL CHECK (event IN ('enrolled','confirmed','verified','recovered','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_events_user_idx ON mfa_events(user_id,id);
