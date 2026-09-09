CREATE TABLE customer_prices (
  customer_id uuid NOT NULL REFERENCES customers(id),
  product_id uuid NOT NULL REFERENCES products(id),
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id, product_id)
);

ALTER TABLE order_lines ADD COLUMN unit_price bigint;

CREATE TABLE receivable_entries (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  shipment_line_id uuid NOT NULL UNIQUE REFERENCES shipment_lines(id),
  business_date date NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('shipment')),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  amount bigint NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount = quantity * unit_price)
);

CREATE INDEX customer_prices_product_idx ON customer_prices(product_id, customer_id) WHERE active;
CREATE INDEX receivable_entries_customer_date_idx ON receivable_entries(customer_id, business_date, id);
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_prices, receivable_entries TO b2b_stm_app, b2b_stm_test_app;
