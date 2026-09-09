CREATE TABLE account_email_deliveries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  recipient text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('invitation','password_reset')),
  status text NOT NULL CHECK (status IN ('pending','sent','failed')),
  provider_message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX account_email_deliveries_user_created_idx ON account_email_deliveries(user_id,created_at DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON account_email_deliveries TO b2b_stm_app,b2b_stm_test_app;
