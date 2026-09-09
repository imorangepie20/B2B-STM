ALTER TABLE customers
  ADD COLUMN payment_due_day smallint NOT NULL DEFAULT 10 CHECK (payment_due_day BETWEEN 1 AND 31);

ALTER TABLE customer_prices
  ADD COLUMN tax_category text NOT NULL DEFAULT 'taxable' CHECK (tax_category IN ('taxable','exempt')),
  ADD COLUMN tax_rate_bps integer NOT NULL DEFAULT 1000 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  ADD CONSTRAINT customer_prices_tax_policy_check CHECK (
    (tax_category='exempt' AND tax_rate_bps=0) OR
    (tax_category='taxable' AND tax_rate_bps>0)
  );

ALTER TABLE order_lines
  ADD COLUMN tax_category text NOT NULL DEFAULT 'taxable' CHECK (tax_category IN ('taxable','exempt')),
  ADD COLUMN tax_rate_bps integer NOT NULL DEFAULT 1000 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  ADD CONSTRAINT order_lines_tax_policy_check CHECK (
    (tax_category='exempt' AND tax_rate_bps=0) OR
    (tax_category='taxable' AND tax_rate_bps>0)
  );

ALTER TABLE receivable_entries
  ADD COLUMN supply_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN tax_category text NOT NULL DEFAULT 'exempt' CHECK (tax_category IN ('taxable','exempt')),
  ADD COLUMN tax_rate_bps integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000);

UPDATE receivable_entries SET supply_amount=amount;
ALTER TABLE receivable_entries DROP CONSTRAINT receivable_entries_amount_magnitude_check;
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_amount_breakdown_check CHECK (amount=supply_amount+tax_amount);
ALTER TABLE receivable_entries ADD CONSTRAINT receivable_entries_tax_policy_check CHECK (
  (tax_category='exempt' AND tax_rate_bps=0 AND tax_amount=0) OR
  (tax_category='taxable' AND tax_rate_bps>0)
);

ALTER TABLE return_credits
  ADD COLUMN supply_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount bigint NOT NULL DEFAULT 0;
UPDATE return_credits SET supply_amount=amount;
ALTER TABLE return_credits DROP CONSTRAINT return_credits_check;
ALTER TABLE return_credits ADD CONSTRAINT return_credits_amount_check CHECK (
  supply_amount=credited_quantity*unit_price AND tax_amount>=0 AND amount=supply_amount+tax_amount
);

ALTER TABLE settlement_lines
  ADD COLUMN supply_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount bigint NOT NULL DEFAULT 0;
UPDATE settlement_lines sl SET supply_amount=e.supply_amount,tax_amount=e.tax_amount FROM receivable_entries e WHERE e.id=sl.receivable_entry_id;
ALTER TABLE settlement_lines ADD CONSTRAINT settlement_lines_amount_breakdown_check CHECK (amount=supply_amount+tax_amount);

ALTER TABLE settlements
  ADD COLUMN supply_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN total_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN payment_due_day smallint NOT NULL DEFAULT 10 CHECK (payment_due_day BETWEEN 1 AND 31),
  ADD COLUMN due_date date;
UPDATE settlements s SET supply_amount=x.supply,tax_amount=x.tax,total_amount=x.total
FROM (SELECT settlement_id,sum(supply_amount) AS supply,sum(tax_amount) AS tax,sum(amount) AS total FROM settlement_lines GROUP BY settlement_id) x
WHERE x.settlement_id=s.id;
UPDATE settlements SET due_date=LEAST(
  (period+interval '2 months - 1 day')::date,
  (period+interval '1 month'+(payment_due_day-1)*interval '1 day')::date
) WHERE status='finalized';
ALTER TABLE settlements ADD CONSTRAINT settlements_amount_breakdown_check CHECK (total_amount=supply_amount+tax_amount);
ALTER TABLE settlements ADD CONSTRAINT settlements_due_date_check CHECK ((status='draft' AND due_date IS NULL) OR (status='finalized' AND due_date IS NOT NULL));

GRANT SELECT, INSERT, UPDATE, DELETE ON customers,customer_prices,order_lines,receivable_entries,return_credits,settlement_lines,settlements TO b2b_stm_app,b2b_stm_test_app;
