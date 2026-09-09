CREATE TABLE business_attachments (
  id uuid PRIMARY KEY,
  resource_type text NOT NULL CHECK (resource_type IN ('shipment','return')),
  resource_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 180),
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg','image/png','application/pdf')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_type,resource_id,sha256),
  CHECK (octet_length(content)=byte_size)
);

CREATE INDEX business_attachments_resource_idx ON business_attachments(resource_type,resource_id,created_at,id);
CREATE INDEX business_attachments_customer_idx ON business_attachments(customer_id,created_at DESC,id);
GRANT SELECT,INSERT ON business_attachments TO b2b_stm_app,b2b_stm_test_app;
