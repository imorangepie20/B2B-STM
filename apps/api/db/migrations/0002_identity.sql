CREATE TABLE customers (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  account_type text NOT NULL CHECK (account_type IN ('internal','customer')),
  customer_id uuid REFERENCES customers(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, account_type),
  CHECK ((account_type='customer' AND customer_id IS NOT NULL) OR (account_type='internal' AND customer_id IS NULL))
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL,
  account_type text NOT NULL,
  role text NOT NULL,
  PRIMARY KEY(user_id,role),
  FOREIGN KEY(user_id,account_type) REFERENCES users(id,account_type),
  CHECK ((account_type='customer' AND role='customer') OR
    (account_type='internal' AND role IN ('warehouse','operations','settlement','system')))
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  mfa_verified_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX users_customer_idx ON users(customer_id);
