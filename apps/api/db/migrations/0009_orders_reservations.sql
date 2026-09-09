CREATE TABLE orders (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL CHECK (status IN ('submitted','confirmed','rejected')),
  requested_by uuid NOT NULL REFERENCES users(id),
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  product_id uuid NOT NULL REFERENCES products(id),
  sku text NOT NULL CHECK (sku = upper(trim(sku)) AND sku <> ''),
  product_name text NOT NULL CHECK (btrim(product_name) <> ''),
  sale_unit text NOT NULL CHECK (btrim(sale_unit) <> ''),
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0 AND reserved_quantity <= requested_quantity),
  UNIQUE(order_id, product_id)
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY,
  order_line_id uuid NOT NULL UNIQUE REFERENCES order_lines(id),
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('active','released','shipped')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, product_id) REFERENCES inventory_balances(warehouse_id, product_id)
);

CREATE TABLE reservation_events (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  event_type text NOT NULL CHECK (event_type IN ('created','released','shipped')),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE command_results (
  actor_id uuid NOT NULL REFERENCES users(id),
  command_type text NOT NULL CHECK (btrim(command_type) <> ''),
  request_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, command_type, request_id)
);

CREATE INDEX orders_customer_created_idx ON orders(customer_id, created_at, id);
CREATE INDEX orders_status_created_idx ON orders(status, created_at, id);
CREATE INDEX reservation_events_reservation_created_idx ON reservation_events(reservation_id, created_at, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON orders, order_lines, reservations, reservation_events, command_results TO b2b_stm_app, b2b_stm_test_app;
