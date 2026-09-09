CREATE TABLE import_batches (
  id uuid PRIMARY KEY,
  file_hash text NOT NULL UNIQUE CHECK (file_hash ~ '^[a-f0-9]{64}$'),
  filename text NOT NULL CHECK (btrim(filename) <> ''),
  status text NOT NULL CHECK (status IN ('completed')),
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  created_rows integer NOT NULL CHECK (created_rows >= 0),
  skipped_rows integer NOT NULL CHECK (skipped_rows >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (created_rows + skipped_rows = total_rows)
);

CREATE TABLE import_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batches(id),
  row_number integer NOT NULL CHECK (row_number >= 2),
  record_type text NOT NULL CHECK (record_type IN ('customer','supplier','warehouse','product','price','stock')),
  business_key text NOT NULL CHECK (btrim(business_key) <> ''),
  result text NOT NULL CHECK (result IN ('created','skipped')),
  UNIQUE(batch_id,row_number)
);

CREATE INDEX import_batches_created_at_idx ON import_batches(created_at DESC,id DESC);
CREATE INDEX import_rows_batch_idx ON import_rows(batch_id,row_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON import_batches, import_rows TO b2b_stm_app, b2b_stm_test_app;
GRANT USAGE, SELECT ON SEQUENCE import_rows_id_seq TO b2b_stm_app, b2b_stm_test_app;

