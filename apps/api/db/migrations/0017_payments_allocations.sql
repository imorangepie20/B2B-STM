CREATE TABLE payments (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  payment_date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  reference text NOT NULL CHECK (btrim(reference) <> ''),
  status text NOT NULL CHECK (status IN ('recorded','voided')) DEFAULT 'recorded',
  recorded_by uuid NOT NULL REFERENCES users(id),
  voided_by uuid REFERENCES users(id),
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='recorded' AND voided_by IS NULL AND voided_at IS NULL) OR (status='voided' AND voided_by IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  settlement_id uuid NOT NULL REFERENCES settlements(id),
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_id,settlement_id)
);
CREATE INDEX payments_customer_date_idx ON payments(customer_id,payment_date,id);
GRANT SELECT, INSERT, UPDATE, DELETE ON payments,payment_allocations TO b2b_stm_app,b2b_stm_test_app;
