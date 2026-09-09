CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('order_submitted','shipment_created','settlement_finalized')),
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('order','shipment','settlement')),
  aggregate_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  recipient_email text NOT NULL CHECK (recipient_email=btrim(lower(recipient_email))),
  subject text NOT NULL CHECK (btrim(subject)<>''),
  body text NOT NULL CHECK (btrim(body)<>''),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_type,aggregate_id,recipient_user_id),
  CHECK ((status='sent')=(sent_at IS NOT NULL)),
  CHECK ((status='processing')=(locked_at IS NOT NULL))
);
CREATE INDEX notification_outbox_due_idx ON notification_outbox(next_attempt_at,created_at,id) WHERE status IN ('pending','failed');
GRANT SELECT,INSERT,UPDATE ON notification_outbox TO b2b_stm_app,b2b_stm_test_app;
