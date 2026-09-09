CREATE TABLE shipment_work_lines (
  reservation_id uuid PRIMARY KEY REFERENCES reservations(id),
  picked_quantity integer NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
  inspected_quantity integer NOT NULL DEFAULT 0 CHECK (inspected_quantity >= 0 AND inspected_quantity <= picked_quantity),
  updated_by uuid NOT NULL REFERENCES users(id),
  picked_at timestamptz,
  inspected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE shipment_work_line_events (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  event_type text NOT NULL CHECK (event_type IN ('picked','inspected','shipped','reset')),
  actor_id uuid NOT NULL REFERENCES users(id),
  previous_picked_quantity integer NOT NULL CHECK (previous_picked_quantity >= 0),
  picked_quantity integer NOT NULL CHECK (picked_quantity >= 0),
  previous_inspected_quantity integer NOT NULL CHECK (previous_inspected_quantity >= 0),
  inspected_quantity integer NOT NULL CHECK (inspected_quantity >= 0 AND inspected_quantity <= picked_quantity),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shipment_work_line_events_reservation_time_idx
  ON shipment_work_line_events(reservation_id, created_at, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_work_lines, shipment_work_line_events TO b2b_stm_app, b2b_stm_test_app;
