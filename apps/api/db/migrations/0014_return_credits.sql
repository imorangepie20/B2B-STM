CREATE TABLE return_credits (
  id uuid PRIMARY KEY,
  return_inspection_id uuid NOT NULL UNIQUE REFERENCES return_inspections(id),
  return_line_id uuid NOT NULL REFERENCES return_lines(id),
  shipment_line_id uuid NOT NULL REFERENCES shipment_lines(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  credited_quantity integer NOT NULL CHECK (credited_quantity > 0),
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  amount bigint NOT NULL CHECK (amount >= 0 AND amount = credited_quantity * unit_price),
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE receivable_entries ALTER COLUMN shipment_line_id DROP NOT NULL;
ALTER TABLE receivable_entries ADD COLUMN return_credit_id uuid UNIQUE REFERENCES return_credits(id);
ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_entry_type_check;
ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_amount_check;
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_entry_type_check CHECK (entry_type IN ('shipment','return_credit'));
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_amount_check CHECK ((entry_type='shipment' AND amount >= 0) OR (entry_type='return_credit' AND amount <= 0));
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_source_check CHECK (
  (entry_type='shipment') = (shipment_line_id IS NOT NULL)
  AND (entry_type='return_credit') = (return_credit_id IS NOT NULL)
  AND (entry_type='shipment') = (return_credit_id IS NULL)
  AND (entry_type='return_credit') = (shipment_line_id IS NULL)
);

CREATE INDEX return_credits_customer_time_idx ON return_credits(customer_id, approved_at, id);
GRANT SELECT, INSERT, UPDATE, DELETE ON return_credits TO b2b_stm_app, b2b_stm_test_app;
