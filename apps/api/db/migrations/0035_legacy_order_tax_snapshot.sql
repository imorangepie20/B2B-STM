UPDATE order_lines l
SET tax_category='exempt',tax_rate_bps=0
FROM orders o,migration_meta.migrations m
WHERE l.order_id=o.id
  AND m.name='0034_tax_terms_statements.sql'
  AND o.created_at<=m.applied_at;
