ALTER TABLE mfa_events DROP CONSTRAINT mfa_events_event_check;
ALTER TABLE mfa_events ADD CONSTRAINT mfa_events_event_check CHECK (event IN ('enrolled','confirmed','verified','recovered','failed','reset'));

ALTER TABLE identity_events DROP CONSTRAINT identity_events_event_check;
ALTER TABLE identity_events ADD CONSTRAINT identity_events_event_check CHECK (event IN ('invitation_issued','invitation_accepted','password_reset_issued','password_reset_completed','mfa_reset'));

CREATE TABLE mfa_device_resets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  reset_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_device_resets_user_created_idx ON mfa_device_resets(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_device_resets TO b2b_stm_app, b2b_stm_test_app;
