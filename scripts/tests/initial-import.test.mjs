import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { InitialImportService } from '../../apps/api/dist/imports/initial-import.service.js';

const header = 'recordType,code,name,saleUnit,customerCode,sku,warehouseCode,quantity,unitPrice';

test('initial import previews, writes ledger once and rejects conflicting values', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const service = new InitialImportService(pool);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const actorId = randomUUID(), customerCode=`IM-C-${suffix}`, supplierCode=`IM-S-${suffix}`, warehouseCode=`IM-W-${suffix}`, sku=`IM-P-${suffix}`;
  const content = [header,
    `customer,${customerCode},이관 거래처,,,,,,`, `supplier,${supplierCode},이관 공급처,,,,,,`,
    `warehouse,${warehouseCode},이관 창고,,,,,,`, `product,,이관 종이컵,BOX,,${sku},,,`,
    `price,,,,${customerCode},${sku},,,12300`, `stock,,,,,${sku},${warehouseCode},37,`,
  ].join('\n');
  try {
    await pool.query("INSERT INTO users(id,email,account_type) VALUES($1,$2,'internal')", [actorId, `import-${suffix.toLowerCase()}@example.test`]);
    await pool.query("INSERT INTO user_roles(user_id,account_type,role) VALUES($1,'internal','operations')", [actorId]);
    const preview = await service.preview({ filename: 'initial.csv', content });
    assert.deepEqual({ totalRows: preview.totalRows, createdRows: preview.createdRows, skippedRows: preview.skippedRows, errors: preview.errors }, { totalRows: 6, createdRows: 6, skippedRows: 0, errors: [] });
    const applied = await service.apply(actorId, { filename: 'initial.csv', content });
    assert.equal(applied.createdRows, 6);
    assert.equal(applied.duplicate, false);
    const replay = await Promise.all([
      service.apply(actorId, { filename: 'initial.csv', content }),
      service.apply(actorId, { filename: 'initial.csv', content }),
    ]);
    assert(replay.every(result => result.duplicate));
    const stock = await pool.query(`SELECT b.on_hand_quantity,b.reserved_quantity,
      (SELECT sum(m.quantity_delta) FROM inventory_movements m WHERE m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id) AS ledger
      FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN products p ON p.id=b.product_id WHERE w.code=$1 AND p.sku=$2`, [warehouseCode, sku]);
    assert.deepEqual(stock.rows[0], { on_hand_quantity: 37, reserved_quantity: 0, ledger: '37' });
    const conflict = await service.preview({ filename: 'conflict.csv', content: `${header}\ncustomer,${customerCode},다른 이름,,,,,,` });
    assert.equal(conflict.errors.length, 1);
    await assert.rejects(service.apply(actorId, { filename: 'conflict.csv', content: `${header}\ncustomer,${customerCode},다른 이름,,,,,,` }));
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM customers WHERE code=$1', [customerCode])).rows[0].count, 1);
  } finally {
    const batchIds=(await pool.query("SELECT id FROM import_batches WHERE created_by=$1",[actorId])).rows.map(row=>row.id);
    await pool.query('DELETE FROM import_rows WHERE batch_id=ANY($1::uuid[])',[batchIds]);
    await pool.query('DELETE FROM import_batches WHERE id=ANY($1::uuid[])',[batchIds]);
    await pool.query('DELETE FROM customer_prices WHERE customer_id IN(SELECT id FROM customers WHERE code=$1)',[customerCode]);
    await pool.query('DELETE FROM inventory_movements WHERE created_by=$1',[actorId]);
    await pool.query('DELETE FROM inventory_adjustments WHERE adjusted_by=$1',[actorId]);
    await pool.query('DELETE FROM inventory_balances WHERE warehouse_id IN(SELECT id FROM warehouses WHERE code=$1)',[warehouseCode]);
    await pool.query('DELETE FROM products WHERE sku=$1',[sku]);
    await pool.query('DELETE FROM warehouses WHERE code=$1',[warehouseCode]);
    await pool.query('DELETE FROM suppliers WHERE code=$1',[supplierCode]);
    await pool.query('DELETE FROM customers WHERE code=$1',[customerCode]);
    await pool.query('DELETE FROM user_roles WHERE user_id=$1',[actorId]);
    await pool.query('DELETE FROM users WHERE id=$1',[actorId]);
    await pool.end();
  }
});
