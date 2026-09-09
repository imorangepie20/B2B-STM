ALTER TABLE return_defect_dispositions DROP CONSTRAINT return_defect_dispositions_disposition_check;
ALTER TABLE return_defect_dispositions ADD CONSTRAINT return_defect_dispositions_disposition_check CHECK (disposition IN ('quarantine','disposed','supplier_return'));
ALTER TABLE return_defect_dispositions ADD COLUMN supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE return_defect_dispositions ADD COLUMN external_reference text;
ALTER TABLE return_defect_dispositions ADD CONSTRAINT return_defect_dispositions_supplier_check CHECK (
  (disposition='supplier_return' AND supplier_id IS NOT NULL AND btrim(external_reference) <> '')
  OR (disposition<>'supplier_return' AND supplier_id IS NULL)
);

CREATE TABLE return_defect_resolutions (
  id uuid PRIMARY KEY,
  quarantine_disposition_id uuid NOT NULL REFERENCES return_defect_dispositions(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  resolution text NOT NULL CHECK (resolution IN ('disposed','supplier_return')),
  supplier_id uuid REFERENCES suppliers(id),
  external_reference text,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  resolved_by uuid NOT NULL REFERENCES users(id),
  resolved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (resolution='supplier_return' AND supplier_id IS NOT NULL AND btrim(external_reference) <> '')
    OR (resolution='disposed' AND supplier_id IS NULL)
  )
);
CREATE INDEX return_defect_resolutions_disposition_idx ON return_defect_resolutions(quarantine_disposition_id,resolved_at,id);

CREATE TABLE refunds (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  source_type text NOT NULL CHECK (source_type IN ('payment','return_credit')),
  payment_id uuid REFERENCES payments(id),
  return_credit_id uuid REFERENCES return_credits(id),
  refund_date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('bank_transfer','cash','card_reversal','other')),
  reference text NOT NULL UNIQUE CHECK (btrim(reference) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source_type='payment' AND payment_id IS NOT NULL AND return_credit_id IS NULL)
    OR (source_type='return_credit' AND payment_id IS NULL AND return_credit_id IS NOT NULL)
  )
);
CREATE INDEX refunds_customer_date_idx ON refunds(customer_id,refund_date DESC,id);
CREATE INDEX refunds_payment_idx ON refunds(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX refunds_return_credit_idx ON refunds(return_credit_id) WHERE return_credit_id IS NOT NULL;

ALTER TABLE receivable_entries ADD COLUMN refund_id uuid UNIQUE REFERENCES refunds(id);
ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_entry_type_check;
ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_amount_check;
ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_source_check;
ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_amount_magnitude_check;
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_entry_type_check CHECK (entry_type IN ('shipment','return_credit','refund'));
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_amount_check CHECK ((entry_type='return_credit' AND amount <= 0) OR (entry_type IN ('shipment','refund') AND amount >= 0));
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_amount_magnitude_check CHECK (abs(amount) = quantity * unit_price);
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_source_check CHECK (
  num_nonnulls(shipment_line_id,return_credit_id,refund_id)=1
  AND (entry_type='shipment')=(shipment_line_id IS NOT NULL)
  AND (entry_type='return_credit')=(return_credit_id IS NOT NULL)
  AND (entry_type='refund')=(refund_id IS NOT NULL)
);

GRANT SELECT,INSERT,UPDATE,DELETE ON return_defect_resolutions,refunds TO b2b_stm_app,b2b_stm_test_app;
