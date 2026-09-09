CREATE TABLE order_cancellations (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  cancelled_by uuid NOT NULL REFERENCES users(id),
  cancelled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_cancellations_time_idx ON order_cancellations(cancelled_at, order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON order_cancellations TO b2b_stm_app, b2b_stm_test_app;
