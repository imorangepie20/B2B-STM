CREATE TABLE data_exports (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  dataset text NOT NULL CHECK (dataset IN ('orders','inventory','settlements')),
  format text NOT NULL CHECK (format IN ('csv','xlsx')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters)='object'),
  row_count integer NOT NULL CHECK (row_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX data_exports_actor_created_idx ON data_exports(actor_id,created_at DESC,id);
GRANT SELECT,INSERT ON data_exports TO b2b_stm_app,b2b_stm_test_app;
