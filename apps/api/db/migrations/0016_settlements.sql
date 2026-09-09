CREATE TABLE settlements (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  period date NOT NULL CHECK (period = date_trunc('month', period)::date),
  status text NOT NULL CHECK (status IN ('draft','finalized')) DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES users(id),
  finalized_by uuid REFERENCES users(id),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, period),
  CHECK ((status='draft' AND finalized_by IS NULL AND finalized_at IS NULL) OR (status='finalized' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL))
);
CREATE TABLE settlement_lines (
  id uuid PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES settlements(id),
  receivable_entry_id uuid NOT NULL UNIQUE REFERENCES receivable_entries(id),
  amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(settlement_id, receivable_entry_id)
);
CREATE INDEX settlements_customer_period_idx ON settlements(customer_id,period DESC,id);
GRANT SELECT, INSERT, UPDATE, DELETE ON settlements,settlement_lines TO b2b_stm_app,b2b_stm_test_app;
