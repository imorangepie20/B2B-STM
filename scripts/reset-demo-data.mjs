import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import pg from 'pg';
import { assertDemoTarget } from './lib/demo-seed.mjs';

const credentialsPath = new URL('../.demo-credentials.json', import.meta.url);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000, query_timeout: 30_000 });

try {
  assert.deepEqual(process.argv.slice(2), ['--development', '--confirm-reset']);
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assertDemoTarget(process.env.DATABASE_URL);
  await db.connect();
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('b2b-stm-demo-seed'))");
  const customers = (await db.query("SELECT id FROM customers WHERE code LIKE 'DEMO-%'")).rows.map(row => row.id);
  const users = (await db.query("SELECT id FROM users WHERE email LIKE 'demo.%@stm.local' OR customer_id=ANY($1::uuid[])", [customers])).rows.map(row => row.id);
  const orders = (await db.query('SELECT id FROM orders WHERE customer_id=ANY($1::uuid[])', [customers])).rows.map(row => row.id);
  await db.query('DELETE FROM business_attachments WHERE customer_id=ANY($1::uuid[])', [customers]);
  await db.query('DELETE FROM data_exports WHERE actor_id=ANY($1::uuid[])', [users]);
  await db.query(`DELETE FROM notification_outbox WHERE aggregate_id=ANY($1::uuid[])
    OR aggregate_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))
    OR aggregate_id IN (SELECT id FROM settlements WHERE customer_id=ANY($2::uuid[]))`, [orders, customers]);
  await db.query('DELETE FROM notification_outbox WHERE recipient_user_id=ANY($1::uuid[])', [users]);
  await db.query("DELETE FROM stock_count_reservation_adjustments WHERE stock_count_id IN (SELECT sc.id FROM stock_counts sc JOIN warehouses w ON w.id=sc.warehouse_id WHERE w.code LIKE 'DEMO-%')");
  await db.query("DELETE FROM stock_counts WHERE warehouse_id IN (SELECT id FROM warehouses WHERE code LIKE 'DEMO-%')");

  await db.query('DELETE FROM payment_allocation_reversals WHERE payment_allocation_id IN (SELECT pa.id FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE p.customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE customer_id=ANY($1::uuid[])) OR settlement_id IN (SELECT id FROM settlements WHERE customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM settlement_lines WHERE settlement_id IN (SELECT id FROM settlements WHERE customer_id=ANY($1::uuid[])) OR receivable_entry_id IN (SELECT id FROM receivable_entries WHERE customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM settlements WHERE customer_id=ANY($1::uuid[])', [customers]);
  await db.query('DELETE FROM receivable_entries WHERE customer_id=ANY($1::uuid[])', [customers]);
  await db.query('DELETE FROM refunds WHERE customer_id=ANY($1::uuid[])', [customers]);
  await db.query('DELETE FROM payments WHERE customer_id=ANY($1::uuid[])', [customers]);
  await db.query('DELETE FROM return_defect_resolutions WHERE quarantine_disposition_id IN (SELECT d.id FROM return_defect_dispositions d JOIN return_inspections ri ON ri.id=d.return_inspection_id JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM return_defect_dispositions WHERE return_inspection_id IN (SELECT ri.id FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM return_credits WHERE customer_id=ANY($1::uuid[])', [customers]);
  await db.query('DELETE FROM inventory_movements WHERE return_inspection_id IN (SELECT ri.id FROM return_inspections ri JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id WHERE r.customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM return_inspections WHERE return_line_id IN (SELECT rl.id FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM return_lines WHERE return_id IN (SELECT id FROM returns WHERE customer_id=ANY($1::uuid[]))', [customers]);
  await db.query('DELETE FROM returns WHERE customer_id=ANY($1::uuid[])', [customers]);
  await db.query('DELETE FROM shipment_work_line_events WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines ol ON ol.id=r.order_line_id WHERE ol.order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM shipment_work_lines WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines ol ON ol.id=r.order_line_id WHERE ol.order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM shipment_work_assignment_events WHERE order_id=ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM shipment_work_assignments WHERE order_id=ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM inventory_movements WHERE shipment_line_id IN (SELECT sl.id FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id WHERE s.order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM shipment_delivery_events WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM shipment_deliveries WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM shipment_lines WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM shipments WHERE order_id=ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM reservation_events WHERE reservation_id IN (SELECT r.id FROM reservations r JOIN order_lines ol ON ol.id=r.order_line_id WHERE ol.order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM reservations WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id=ANY($1::uuid[]))', [orders]);
  await db.query('DELETE FROM order_cancellation_requests WHERE order_id=ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM order_cancellations WHERE order_id=ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM order_lines WHERE order_id=ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM orders WHERE id=ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM command_results WHERE actor_id=ANY($1::uuid[])', [users]);
  await db.query("DELETE FROM inventory_movements WHERE warehouse_id IN (SELECT id FROM warehouses WHERE code LIKE 'DEMO-%')");
  await db.query("DELETE FROM receipt_lines WHERE receipt_id IN (SELECT id FROM receipts WHERE warehouse_id IN (SELECT id FROM warehouses WHERE code LIKE 'DEMO-%'))");
  await db.query("DELETE FROM receipts WHERE warehouse_id IN (SELECT id FROM warehouses WHERE code LIKE 'DEMO-%')");
  await db.query("DELETE FROM inventory_adjustments WHERE warehouse_id IN (SELECT id FROM warehouses WHERE code LIKE 'DEMO-%')");
  await db.query("DELETE FROM inventory_balances WHERE warehouse_id IN (SELECT id FROM warehouses WHERE code LIKE 'DEMO-%') OR product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')");
  await db.query("DELETE FROM customer_prices WHERE customer_id=ANY($1::uuid[]) OR product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')", [customers]);
  await db.query("DELETE FROM products WHERE sku LIKE 'DEMO-%'");
  await db.query("DELETE FROM suppliers WHERE code LIKE 'DEMO-%'");
  await db.query("DELETE FROM warehouses WHERE code LIKE 'DEMO-%'");
  await db.query('DELETE FROM mfa_device_resets WHERE user_id=ANY($1::uuid[]) OR reset_by=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM mfa_events WHERE user_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM mfa_recovery_codes WHERE user_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM mfa_credentials WHERE user_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM account_email_deliveries WHERE user_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM account_status_changes WHERE user_id=ANY($1::uuid[]) OR changed_by=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM identity_events WHERE user_id=ANY($1::uuid[]) OR actor_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM account_tokens WHERE user_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
  await db.query('DELETE FROM customers WHERE id=ANY($1::uuid[])', [customers]);
  await db.query('COMMIT');
  await unlink(credentialsPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  console.log(`Demo data reset: ${customers.length} customers, ${orders.length} orders, ${users.length} users removed`);
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : 'Demo reset failed');
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
