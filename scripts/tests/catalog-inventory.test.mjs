import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

test('catalog and inventory reject invalid available stock states', async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/b2b_stm_test');
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const supplier = randomUUID(), warehouse = randomUUID(), product = randomUUID();
  await db.connect();
  try {
    await db.query("INSERT INTO suppliers(id,code,name) VALUES ($1,$2,'Test supplier')", [supplier, `SUP-${suffix}`]);
    await db.query("INSERT INTO warehouses(id,code,name) VALUES ($1,$2,'Main warehouse')", [warehouse, `WH-${suffix}`]);
    await db.query("INSERT INTO products(id,sku,name,sale_unit) VALUES ($1,$2,'Test cup','box')", [product, `SKU-${suffix}`]);
    await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES ($1,$2,10,3)', [warehouse, product]);
    await assert.rejects(db.query('UPDATE inventory_balances SET reserved_quantity=11 WHERE warehouse_id=$1 AND product_id=$2', [warehouse, product]));
    await assert.rejects(db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES ($1,$2,-1,0)', [warehouse, randomUUID()]));
  } finally {
    await db.query('DELETE FROM inventory_balances WHERE warehouse_id=$1', [warehouse]);
    await db.query('DELETE FROM products WHERE id=$1', [product]);
    await db.query('DELETE FROM suppliers WHERE id=$1', [supplier]);
    await db.query('DELETE FROM warehouses WHERE id=$1', [warehouse]);
    await db.end();
  }
});
