CREATE TABLE stock_counts (
  id uuid PRIMARY KEY,
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN('counting','finalized','cancelled')),
  snapshot_on_hand_quantity integer NOT NULL CHECK(snapshot_on_hand_quantity>=0),
  snapshot_reserved_quantity integer NOT NULL CHECK(snapshot_reserved_quantity>=0),
  counted_quantity integer CHECK(counted_quantity IS NULL OR counted_quantity>=0),
  released_reservation_quantity integer NOT NULL DEFAULT 0 CHECK(released_reservation_quantity>=0),
  reason text NOT NULL CHECK(btrim(reason)<>''),
  started_by uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finalized_by uuid REFERENCES users(id),
  finalized_at timestamptz,
  cancelled_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  adjustment_id uuid UNIQUE REFERENCES inventory_adjustments(id),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(warehouse_id,product_id) REFERENCES inventory_balances(warehouse_id,product_id),
  CHECK(
    (status='counting' AND counted_quantity IS NULL AND finalized_by IS NULL AND finalized_at IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL)
    OR (status='finalized' AND counted_quantity IS NOT NULL AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL AND cancelled_by IS NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND counted_quantity IS NULL AND finalized_by IS NULL AND finalized_at IS NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX stock_counts_active_balance_idx ON stock_counts(warehouse_id,product_id) WHERE status='counting';
CREATE INDEX stock_counts_started_idx ON stock_counts(started_at DESC,id DESC);

CREATE TABLE stock_count_reservation_adjustments (
  id uuid PRIMARY KEY,
  stock_count_id uuid NOT NULL REFERENCES stock_counts(id),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  released_quantity integer NOT NULL CHECK(released_quantity>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(stock_count_id,reservation_id)
);

GRANT SELECT,INSERT,UPDATE,DELETE ON stock_counts,stock_count_reservation_adjustments TO b2b_stm_app,b2b_stm_test_app;
