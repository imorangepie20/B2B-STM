ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_check;
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_amount_magnitude_check CHECK (abs(amount) = quantity * unit_price);
