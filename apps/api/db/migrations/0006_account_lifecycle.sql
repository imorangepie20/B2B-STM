CREATE TABLE account_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('invitation', 'password_reset')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX account_tokens_current_idx ON account_tokens(user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX account_tokens_expiry_idx ON account_tokens(expires_at);
CREATE TABLE identity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  actor_id uuid REFERENCES users(id),
  event text NOT NULL CHECK (event IN ('invitation_issued', 'invitation_accepted', 'password_reset_issued', 'password_reset_completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_events_user_idx ON identity_events(user_id, id);
