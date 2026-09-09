CREATE TABLE shipment_work_assignments (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  assigned_to uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shipment_work_assignments_assignee_time_idx
  ON shipment_work_assignments(assigned_to, assigned_at, order_id);

CREATE TABLE shipment_work_assignment_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  event_type text NOT NULL CHECK (event_type IN ('claimed','released','completed','cancelled')),
  actor_id uuid NOT NULL REFERENCES users(id),
  assignee_id uuid NOT NULL REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type <> 'released' OR btrim(COALESCE(reason,'')) <> '')
);

CREATE INDEX shipment_work_assignment_events_order_time_idx
  ON shipment_work_assignment_events(order_id, created_at, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_work_assignments, shipment_work_assignment_events TO b2b_stm_app, b2b_stm_test_app;
