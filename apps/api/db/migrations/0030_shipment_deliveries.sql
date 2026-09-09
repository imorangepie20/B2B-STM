CREATE TABLE shipment_deliveries (
  shipment_id uuid PRIMARY KEY REFERENCES shipments(id), status text NOT NULL DEFAULT 'ready' CHECK(status IN('ready','scheduled','in_transit','delivered','failed')),
  scheduled_date date, carrier_name text, tracking_number text, dispatched_at timestamptz, delivered_at timestamptz,
  recipient_name text, proof_method text CHECK(proof_method IS NULL OR proof_method IN('signature','photo','staff_confirmation')), proof_note text,
  failure_reason text, updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE shipment_delivery_events (
 id uuid PRIMARY KEY, shipment_id uuid NOT NULL REFERENCES shipments(id), event_type text NOT NULL CHECK(event_type IN('created','scheduled','dispatched','delivered','failed','rescheduled')),
 actor_id uuid NOT NULL REFERENCES users(id), from_status text, to_status text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_deliveries_status_date_idx ON shipment_deliveries(status,scheduled_date,shipment_id);
CREATE INDEX shipment_delivery_events_shipment_time_idx ON shipment_delivery_events(shipment_id,created_at,id);
GRANT SELECT,INSERT,UPDATE,DELETE ON shipment_deliveries,shipment_delivery_events TO b2b_stm_app,b2b_stm_test_app;
