ALTER TABLE reservations ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0 CHECK (shipped_quantity >= 0 AND shipped_quantity <= quantity);

CREATE TABLE shipments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL CHECK (status IN ('shipped')),
  shipped_by uuid NOT NULL REFERENCES users(id),
  shipped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipment_lines (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  UNIQUE(shipment_id, reservation_id)
);

ALTER TABLE inventory_movements ADD COLUMN shipment_line_id uuid UNIQUE REFERENCES shipment_lines(id);
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_reference_check CHECK (
  (movement_type='receipt') = (receipt_line_id IS NOT NULL)
  AND (movement_type='shipment') = (shipment_line_id IS NOT NULL)
  AND (movement_type NOT IN ('receipt','shipment')) = (receipt_line_id IS NULL AND shipment_line_id IS NULL)
);

CREATE INDEX shipments_warehouse_time_idx ON shipments(warehouse_id, shipped_at, id);
CREATE INDEX shipment_lines_reservation_idx ON shipment_lines(reservation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON shipments, shipment_lines TO b2b_stm_app, b2b_stm_test_app;
