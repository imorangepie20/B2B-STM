CREATE TABLE account_status_changes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  changed_by uuid NOT NULL REFERENCES users(id),
  active boolean NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 4 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_status_changes_user_created_idx
  ON account_status_changes(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON account_status_changes TO b2b_stm_app, b2b_stm_test_app;
