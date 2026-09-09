CREATE TABLE returns (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  status text NOT NULL CHECK (status IN ('requested','inspecting','inspected')) DEFAULT 'requested',
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE return_lines (
  id uuid PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES returns(id),
  shipment_line_id uuid NOT NULL REFERENCES shipment_lines(id),
  product_id uuid NOT NULL REFERENCES products(id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= requested_quantity),
  normal_quantity integer NOT NULL DEFAULT 0 CHECK (normal_quantity >= 0 AND normal_quantity <= received_quantity),
  defective_quantity integer NOT NULL DEFAULT 0 CHECK (defective_quantity >= 0 AND defective_quantity <= received_quantity),
  CHECK (normal_quantity + defective_quantity = received_quantity),
  UNIQUE(return_id, shipment_line_id)
);

CREATE TABLE return_inspections (
  id uuid PRIMARY KEY,
  return_line_id uuid NOT NULL REFERENCES return_lines(id),
  received_quantity integer NOT NULL CHECK (received_quantity > 0),
  normal_quantity integer NOT NULL CHECK (normal_quantity >= 0),
  defective_quantity integer NOT NULL CHECK (defective_quantity >= 0),
  defective_reason text,
  inspected_by uuid NOT NULL REFERENCES users(id),
  inspected_at timestamptz NOT NULL DEFAULT now(),
  CHECK (normal_quantity + defective_quantity = received_quantity),
  CHECK ((defective_quantity = 0 AND defective_reason IS NULL) OR (defective_quantity > 0 AND btrim(defective_reason) <> ''))
);

ALTER TABLE inventory_movements ADD COLUMN return_inspection_id uuid UNIQUE REFERENCES return_inspections(id);
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_reference_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_reference_check CHECK (
  (movement_type='receipt') = (receipt_line_id IS NOT NULL)
  AND (movement_type='shipment') = (shipment_line_id IS NOT NULL)
  AND (movement_type='adjustment') = (adjustment_id IS NOT NULL)
  AND (movement_type='return') = (return_inspection_id IS NOT NULL)
  AND (movement_type NOT IN ('receipt','shipment','adjustment','return')) = (receipt_line_id IS NULL AND shipment_line_id IS NULL AND adjustment_id IS NULL AND return_inspection_id IS NULL)
);

CREATE INDEX returns_customer_requested_idx ON returns(customer_id, requested_at DESC, id);
CREATE INDEX return_lines_shipment_line_idx ON return_lines(shipment_line_id);
CREATE INDEX return_inspections_line_time_idx ON return_inspections(return_line_id, inspected_at, id);
GRANT SELECT, INSERT, UPDATE, DELETE ON returns, return_lines, return_inspections TO b2b_stm_app, b2b_stm_test_app;
