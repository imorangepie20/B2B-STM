CREATE TABLE inventory_adjustments (
  id uuid PRIMARY KEY,
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  adjusted_by uuid NOT NULL REFERENCES users(id),
  adjusted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, product_id) REFERENCES inventory_balances(warehouse_id, product_id)
);

ALTER TABLE inventory_movements ADD COLUMN adjustment_id uuid UNIQUE REFERENCES inventory_adjustments(id);
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_reference_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_reference_check CHECK (
  (movement_type='receipt') = (receipt_line_id IS NOT NULL)
  AND (movement_type='shipment') = (shipment_line_id IS NOT NULL)
  AND (movement_type='adjustment') = (adjustment_id IS NOT NULL)
  AND (movement_type NOT IN ('receipt','shipment','adjustment')) = (receipt_line_id IS NULL AND shipment_line_id IS NULL AND adjustment_id IS NULL)
);

CREATE INDEX inventory_adjustments_balance_time_idx ON inventory_adjustments(warehouse_id, product_id, adjusted_at, id);
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_adjustments TO b2b_stm_app, b2b_stm_test_app;
