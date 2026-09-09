ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('submitted','confirmed','rejected','cancelled'));
ALTER TABLE orders DROP CONSTRAINT orders_check;
ALTER TABLE orders ADD CONSTRAINT orders_confirmation_check CHECK ((status IN ('confirmed','cancelled')) = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL));
