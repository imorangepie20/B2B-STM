CREATE TABLE payment_allocation_reversals (
  id uuid PRIMARY KEY,
  payment_allocation_id uuid NOT NULL UNIQUE REFERENCES payment_allocations(id),
  reversed_by uuid NOT NULL REFERENCES users(id),
  reversed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (btrim(reason) <> '')
);
CREATE INDEX payment_allocation_reversals_time_idx ON payment_allocation_reversals(reversed_at,id);
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_allocation_reversals TO b2b_stm_app,b2b_stm_test_app;
