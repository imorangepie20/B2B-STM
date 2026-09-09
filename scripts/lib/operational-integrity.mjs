import assert from 'node:assert/strict';

const snapshotTables = [
  'customers',
  'users',
  'products',
  'inventory_balances',
  'inventory_movements',
  'orders',
  'order_lines',
  'reservations',
  'reservation_events',
  'shipments',
  'shipment_lines',
  'shipment_work_assignments',
  'shipment_work_assignment_events',
  'shipment_work_lines',
  'shipment_work_line_events',
  'shipment_deliveries',
  'shipment_delivery_events',
  'stock_counts',
  'stock_count_reservation_adjustments',
  'return_defect_dispositions',
  'return_defect_resolutions',
  'order_cancellation_requests',
  'returns',
  'return_lines',
  'receivable_entries',
  'settlements',
  'settlement_lines',
  'payments',
  'payment_allocations',
  'refunds',
  'command_results',
  'import_batches',
  'import_rows',
  'data_exports',
  'business_attachments',
  'notification_outbox',
];

export const snapshotSql = `SELECT json_build_object(${snapshotTables
  .map(table => `'${table}',(SELECT count(*)::int FROM ${table})`)
  .join(',')}) AS result`;

export const integritySql = `SELECT json_build_object(
  'invalid_inventory_balances',(
    SELECT count(*)::int FROM inventory_balances
    WHERE on_hand_quantity < 0 OR reserved_quantity < 0 OR reserved_quantity > on_hand_quantity
  ),
  'inventory_reservation_mismatch',(
    SELECT count(*)::int
    FROM inventory_balances b
    LEFT JOIN (
      SELECT warehouse_id,product_id,sum(quantity-shipped_quantity)::int AS quantity
      FROM reservations WHERE status='active' GROUP BY warehouse_id,product_id
    ) active ON active.warehouse_id=b.warehouse_id AND active.product_id=b.product_id
    WHERE b.reserved_quantity <> COALESCE(active.quantity,0)
  ),
  'order_line_reservation_mismatch',(
    SELECT count(*)::int FROM order_lines l LEFT JOIN reservations r ON r.order_line_id=l.id
    WHERE l.reserved_quantity <> COALESCE(CASE WHEN r.status='released' THEN r.shipped_quantity ELSE r.quantity END,0)
  ),
  'shipment_ledger_mismatch',(
    SELECT count(*)::int
    FROM shipment_lines sl
    JOIN reservations r ON r.id=sl.reservation_id
    JOIN order_lines l ON l.id=r.order_line_id
    LEFT JOIN receivable_entries re ON re.shipment_line_id=sl.id
    WHERE re.id IS NULL OR re.quantity <> sl.quantity OR re.unit_price <> l.unit_price
      OR re.supply_amount <> sl.quantity*l.unit_price OR re.amount<>re.supply_amount+re.tax_amount
  ),
  'invalid_pending_cancellations',(
    SELECT count(*)::int FROM order_cancellation_requests cr JOIN orders o ON o.id=cr.order_id
    WHERE cr.status='submitted' AND o.status<>'confirmed'
  ),
  'invalid_shipment_work_assignments',(
    SELECT count(*)::int FROM shipment_work_assignments a JOIN orders o ON o.id=a.order_id
    WHERE o.status<>'confirmed'
      OR EXISTS (SELECT 1 FROM order_cancellation_requests cr WHERE cr.order_id=a.order_id AND cr.status='submitted')
      OR NOT EXISTS (
        SELECT 1 FROM reservations r JOIN order_lines l ON l.id=r.order_line_id
        WHERE l.order_id=a.order_id AND r.status='active' AND r.quantity>r.shipped_quantity
      )
  ),
  'invalid_shipment_work_lines',(
    SELECT count(*)::int FROM shipment_work_lines swl
    JOIN reservations r ON r.id=swl.reservation_id
    WHERE swl.inspected_quantity>swl.picked_quantity
      OR swl.picked_quantity>CASE WHEN r.status='active' THEN r.quantity-r.shipped_quantity ELSE 0 END
      OR (r.status<>'active' AND (swl.picked_quantity>0 OR swl.inspected_quantity>0))
  ),
  'invalid_shipment_deliveries',(
    SELECT count(*)::int FROM shipment_deliveries d
    WHERE (d.status IN ('scheduled','in_transit','delivered') AND (d.scheduled_date IS NULL OR d.carrier_name IS NULL OR d.tracking_number IS NULL))
      OR (d.status IN ('in_transit','delivered') AND d.dispatched_at IS NULL)
      OR (d.status='delivered' AND (d.delivered_at IS NULL OR d.recipient_name IS NULL OR d.proof_method IS NULL OR d.proof_note IS NULL))
      OR (d.status='failed' AND d.failure_reason IS NULL)
  ),
  'invalid_stock_counts',(
    SELECT count(*)::int FROM stock_counts sc
    WHERE sc.snapshot_reserved_quantity>sc.snapshot_on_hand_quantity
      OR (sc.status='finalized' AND sc.counted_quantity<(SELECT COALESCE(sum(r.quantity-r.shipped_quantity),0) FROM reservations r WHERE r.warehouse_id=sc.warehouse_id AND r.product_id=sc.product_id AND r.status='active'))
      OR (sc.status='counting' AND EXISTS(SELECT 1 FROM shipment_work_lines swl JOIN reservations r ON r.id=swl.reservation_id WHERE r.warehouse_id=sc.warehouse_id AND r.product_id=sc.product_id AND r.status='active' AND (swl.picked_quantity>0 OR swl.inspected_quantity>0)))
  ),
  'overallocated_payments',(
    SELECT count(*)::int FROM payments p
    WHERE COALESCE((
      SELECT sum(pa.amount) FROM payment_allocations pa
      LEFT JOIN payment_allocation_reversals pr ON pr.payment_allocation_id=pa.id
      WHERE pa.payment_id=p.id AND pr.id IS NULL
    ),0) + COALESCE((SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id=p.id),0) > p.amount
  ),
  'overresolved_defects',(
    SELECT count(*)::int FROM return_defect_dispositions d
    WHERE d.disposition='quarantine' AND COALESCE((SELECT sum(x.quantity) FROM return_defect_resolutions x WHERE x.quarantine_disposition_id=d.id),0)>d.quantity
  ),
  'overrefunded_return_credits',(
    SELECT count(*)::int FROM return_credits rc
    WHERE COALESCE((SELECT sum(rf.amount) FROM refunds rf WHERE rf.return_credit_id=rc.id),0)>rc.amount
  ),
  'invalid_refund_ledgers',(
    SELECT count(*)::int FROM refunds rf LEFT JOIN receivable_entries e ON e.refund_id=rf.id
    WHERE (rf.source_type='return_credit' AND (e.id IS NULL OR e.amount<>rf.amount)) OR (rf.source_type='payment' AND e.id IS NOT NULL)
  ),
  'invalid_tax_settlements',(
    SELECT count(*)::int FROM settlements s
    WHERE s.total_amount<>s.supply_amount+s.tax_amount
      OR EXISTS(SELECT 1 FROM settlement_lines sl WHERE sl.settlement_id=s.id AND sl.amount<>sl.supply_amount+sl.tax_amount)
      OR (s.status='finalized' AND s.due_date IS NULL)
  ),
  'import_batch_row_mismatch',(
    SELECT count(*)::int FROM import_batches b
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE result='created')::int AS created,
        count(*) FILTER (WHERE result='skipped')::int AS skipped
      FROM import_rows WHERE batch_id=b.id
    ) r ON true
    WHERE b.total_rows<>r.total OR b.created_rows<>r.created OR b.skipped_rows<>r.skipped
  )
) AS result`;

export function assertLocalRehearsalTarget(connectionString) {
  const target = new URL(connectionString);
  assert(['postgresql:', 'postgres:'].includes(target.protocol), 'PostgreSQL URL required');
  assert.equal(target.pathname, '/b2b_stm', 'Local B2B development database required');
  assert(['127.0.0.1', 'localhost'].includes(target.hostname), 'Local PostgreSQL host required');
  return target;
}

export function assertSafeContainerName(value) {
  assert.match(value, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/, 'Unsafe PostgreSQL container name');
  return value;
}

export function compareSnapshots(source, restored) {
  const differences = [...new Set([...Object.keys(source), ...Object.keys(restored)])]
    .sort()
    .filter(key => Number(source[key]) !== Number(restored[key]))
    .map(key => `${key}: source=${String(source[key])} restored=${String(restored[key])}`);
  assert.equal(differences.length, 0, `Restore snapshot mismatch: ${differences.join(', ')}`);
}

export function assertNoIntegrityViolations(result) {
  const violations = Object.entries(result)
    .filter(([, count]) => Number(count) !== 0)
    .map(([name, count]) => `${name}=${String(count)}`);
  assert.equal(violations.length, 0, `Operational integrity violation: ${violations.join(', ')}`);
}
