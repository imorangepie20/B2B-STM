CREATE TABLE order_cancellation_requests (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'submitted' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL)
    OR
    (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR
    (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND btrim(review_note) <> '')
  )
);

CREATE UNIQUE INDEX order_cancellation_requests_submitted_order_idx
  ON order_cancellation_requests(order_id) WHERE status = 'submitted';
CREATE INDEX order_cancellation_requests_status_time_idx
  ON order_cancellation_requests(status, requested_at, id);
CREATE INDEX order_cancellation_requests_order_time_idx
  ON order_cancellation_requests(order_id, requested_at DESC, id DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON order_cancellation_requests TO b2b_stm_app, b2b_stm_test_app;
