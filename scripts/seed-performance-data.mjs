import assert from 'node:assert/strict';
import pg from 'pg';
import {
  assertPerformanceTarget,
  fixtureExpectations,
  performanceFixtureDatabaseUrl,
  readFixtureScale,
  fixtureSchemaReadinessSql,
} from './lib/performance-target.mjs';

const { Client } = pg;
assert(process.argv.includes('--confirm-reset'), 'Pass --confirm-reset explicitly');
const profileArgument = process.argv.find(value => value.startsWith('--profile='))?.slice('--profile='.length);
const scale = readFixtureScale({ PERF_PROFILE: profileArgument ?? 'rehearsal' });
const connectionString = performanceFixtureDatabaseUrl(process.env);
assertPerformanceTarget(connectionString);
const expected = fixtureExpectations(scale);
const db = new Client({ connectionString });

try {
  await db.connect();
  const schema = await db.query(fixtureSchemaReadinessSql);
  assert.equal(schema.rows[0].ready, true, 'Performance database migrations are not applied');
  await db.query('BEGIN');
  await db.query("SET LOCAL statement_timeout='15min'");
  await db.query('TRUNCATE TABLE customers, suppliers, warehouses, products CASCADE');

  await db.query(`INSERT INTO customers(id,code,name)
    SELECT md5('perf:customer:'||g)::uuid,'PERF-CUST-'||lpad(g::text,4,'0'),'성능 거래처 '||g
    FROM generate_series(1,$1::int) g`, [scale.customers]);
  await db.query(`INSERT INTO users(id,email,account_type,customer_id)
    SELECT md5('perf:customer-user:'||g)::uuid,'perf.customer.'||lpad(g::text,4,'0')||'@stm.local','customer',md5('perf:customer:'||g)::uuid
    FROM generate_series(1,$1::int) g`, [scale.customers]);
  await db.query(`INSERT INTO users(id,email,account_type)
    VALUES(md5('perf:operations')::uuid,'perf.operations@stm.local','internal'),
          (md5('perf:warehouse-user')::uuid,'perf.warehouse@stm.local','internal')`);
  await db.query(`INSERT INTO user_roles(user_id,account_type,role)
    SELECT md5('perf:customer-user:'||g)::uuid,'customer','customer' FROM generate_series(1,$1::int) g
    UNION ALL SELECT md5('perf:operations')::uuid,'internal','operations'
    UNION ALL SELECT md5('perf:warehouse-user')::uuid,'internal','warehouse'`, [scale.customers]);
  await db.query("INSERT INTO suppliers(id,code,name) VALUES(md5('perf:supplier:1')::uuid,'PERF-SUP-0001','성능 공급처')");
  await db.query("INSERT INTO warehouses(id,code,name) VALUES(md5('perf:warehouse:1')::uuid,'PERF-WH-0001','성능 중앙창고')");
  await db.query(`INSERT INTO products(id,sku,name,sale_unit)
    SELECT md5('perf:product:'||g)::uuid,'PERF-SKU-'||lpad(g::text,5,'0'),'성능 상품 '||g,'박스'
    FROM generate_series(1,$1::int) g`, [scale.products]);
  await db.query(`INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
    SELECT md5('perf:warehouse:1')::uuid,md5('perf:product:'||g)::uuid,2000000,0
    FROM generate_series(1,$1::int) g`, [scale.products]);
  await db.query(`INSERT INTO customer_prices(customer_id,product_id,unit_price)
    SELECT md5('perf:customer:'||c)::uuid,md5('perf:product:'||p)::uuid,1000+p
    FROM generate_series(1,$1::int) c CROSS JOIN generate_series(1,$2::int) p`, [scale.customers, scale.products]);
  await db.query(`INSERT INTO orders(id,customer_id,warehouse_id,status,requested_by,created_at,updated_at)
    SELECT md5('perf:order:'||g)::uuid,
      md5('perf:customer:'||(((g-1)%$2::int)+1))::uuid,
      md5('perf:warehouse:1')::uuid,'submitted',
      md5('perf:customer-user:'||(((g-1)%$2::int)+1))::uuid,
      now()-(($1::int-g)||' seconds')::interval,
      now()-(($1::int-g)||' seconds')::interval
    FROM generate_series(1,$1::int) g`, [scale.orders, scale.customers]);
  await db.query(`INSERT INTO order_lines(id,order_id,product_id,sku,product_name,sale_unit,requested_quantity,unit_price)
    SELECT md5('perf:order-line:'||o||':'||line)::uuid,
      md5('perf:order:'||o)::uuid,
      md5('perf:product:'||product_no)::uuid,
      'PERF-SKU-'||lpad(product_no::text,5,'0'),'성능 상품 '||product_no,'박스',1,1000+product_no
    FROM generate_series(1,$1::int) o
    CROSS JOIN generate_series(1,$2::int) line
    CROSS JOIN LATERAL (SELECT (((o-1)*$2::int+line-1)%$3::int)+1 AS product_no) product`,
    [scale.orders, scale.linesPerOrder, scale.products]);
  await db.query('COMMIT');
  await db.query('ANALYZE');

  const counts = (await db.query(`SELECT json_build_object(
    'customers',(SELECT count(*)::int FROM customers),
    'products',(SELECT count(*)::int FROM products),
    'orders',(SELECT count(*)::int FROM orders),
    'orderLines',(SELECT count(*)::int FROM order_lines),
    'customerPrices',(SELECT count(*)::int FROM customer_prices)
  ) AS result`)).rows[0].result;
  assert.deepEqual(counts, expected, 'Performance fixture counts do not match the selected profile');
  console.log(JSON.stringify({ database: 'b2b_stm_perf', scale, counts }, null, 2));
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await db.end();
}
