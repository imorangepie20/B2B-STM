CREATE TABLE return_defect_dispositions (
  id uuid PRIMARY KEY,
  return_inspection_id uuid NOT NULL REFERENCES return_inspections(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  disposition text NOT NULL CHECK (disposition IN ('quarantine','disposed')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  decided_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX return_defect_dispositions_inspection_idx ON return_defect_dispositions(return_inspection_id,created_at,id);
GRANT SELECT, INSERT, UPDATE, DELETE ON return_defect_dispositions TO b2b_stm_app,b2b_stm_test_app;
