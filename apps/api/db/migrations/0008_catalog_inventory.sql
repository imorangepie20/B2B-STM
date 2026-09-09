CREATE TABLE suppliers (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code=upper(trim(code)) AND code<>''),
  name text NOT NULL CHECK (btrim(name)<>''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code=upper(trim(code)) AND code<>''),
  name text NOT NULL CHECK (btrim(name)<>''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY,
  sku text NOT NULL UNIQUE CHECK (sku=upper(trim(sku)) AND sku<>''),
  name text NOT NULL CHECK (btrim(name)<>''),
  sale_unit text NOT NULL CHECK (btrim(sale_unit)<>''),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_balances (
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  product_id uuid NOT NULL REFERENCES products(id),
  on_hand_quantity integer NOT NULL DEFAULT 0 CHECK (on_hand_quantity>=0),
  reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity>=0 AND reserved_quantity<=on_hand_quantity),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(warehouse_id,product_id)
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL CHECK (status IN ('draft','confirmed','voided')),
  received_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='confirmed') = (received_at IS NOT NULL))
);

CREATE TABLE receipt_lines (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES receipts(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity>0),
  UNIQUE(receipt_id,product_id)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('receipt','shipment','return','adjustment')),
  quantity_delta integer NOT NULL CHECK (quantity_delta<>0),
  receipt_line_id uuid UNIQUE REFERENCES receipt_lines(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  FOREIGN KEY(warehouse_id,product_id) REFERENCES inventory_balances(warehouse_id,product_id),
  CHECK ((movement_type='receipt') = (receipt_line_id IS NOT NULL))
);

CREATE INDEX inventory_movements_balance_time_idx ON inventory_movements(warehouse_id,product_id,occurred_at,id);
CREATE INDEX products_active_idx ON products(active,sku);
GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers, warehouses, products, inventory_balances, receipts, receipt_lines, inventory_movements TO b2b_stm_app, b2b_stm_test_app;
