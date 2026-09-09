const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const pg = require('pg');
const { chromium, expect } = require('@playwright/test');

const webOrigin = 'http://127.0.0.1:3101';
const digest = value => createHash('sha256').update(value).digest('hex');

(async () => {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/b2b_stm');
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const customerCode=`WEB-C-${suffix}`, supplierCode=`WEB-S-${suffix}`, warehouseCode=`WEB-W-${suffix}`, sku=`WEB-P-${suffix}`;
  const filename=`initial-${suffix}.csv`;
  const content=[
    'recordType,code,name,saleUnit,customerCode,sku,warehouseCode,quantity,unitPrice',
    `customer,${customerCode},브라우저 이관 거래처,,,,,,`, `supplier,${supplierCode},브라우저 이관 공급처,,,,,,`,
    `warehouse,${warehouseCode},브라우저 이관 창고,,,,,,`, `product,,브라우저 이관 상품,BOX,,${sku},,,`,
    `price,,,,${customerCode},${sku},,,15400`, `stock,,,,,${sku},${warehouseCode},25,`,
  ].join('\n');
  const session = randomBytes(32).toString('hex');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const browser = await chromium.launch({ headless: true });
  let actorId;
  try {
    await db.connect();
    actorId=(await db.query("SELECT id FROM users WHERE email='demo.operations@stm.local'")).rows[0]?.id;
    assert(actorId, 'Demo operations account is required');
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at) VALUES($1,$2,now()+interval '1 hour',now(),now())",[digest(session),actorId]);
    const context=await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name:'b2b_session',value:session,url:webOrigin,httpOnly:true,sameSite:'Lax' }]);
    const page=await context.newPage();
    await page.goto(`${webOrigin}/admin/imports`,{ waitUntil:'networkidle' });
    await expect(page.getByRole('heading',{name:'초기 데이터 이관'})).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name:filename,mimeType:'text/csv',buffer:Buffer.from(content) });
    const previewResponse=page.waitForResponse(response=>response.url().includes('/api/admin/imports/preview')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'미리보기',exact:true}).click();
    assert((await previewResponse).ok());
    await expect(page.getByText('생성 6')).toBeVisible();
    const applyResponse=page.waitForResponse(response=>response.url().includes('/api/admin/imports/apply')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'검증 결과 반영'}).click();
    assert((await applyResponse).ok());
    await expect(page.getByText(filename)).toBeVisible();
    await expect(page.getByText('6개 행을 반영했습니다.')).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({ path:path.resolve(__dirname,'../../../docs/screenshots/initial-import-admin.png'),fullPage:true });
    await context.close();
    console.log('Initial import browser verification passed: preview, apply, history');
  } finally {
    await db.query('DELETE FROM sessions WHERE token_hash=$1',[digest(session)]).catch(()=>{});
    const batches=(await db.query('SELECT id FROM import_batches WHERE filename=$1',[filename]).catch(()=>({rows:[]}))).rows.map(row=>row.id);
    await db.query('DELETE FROM import_rows WHERE batch_id=ANY($1::uuid[])',[batches]).catch(()=>{});
    await db.query('DELETE FROM import_batches WHERE id=ANY($1::uuid[])',[batches]).catch(()=>{});
    await db.query('DELETE FROM customer_prices WHERE customer_id IN(SELECT id FROM customers WHERE code=$1)',[customerCode]).catch(()=>{});
    await db.query("DELETE FROM inventory_movements WHERE product_id IN(SELECT id FROM products WHERE sku=$1) AND movement_type='adjustment'",[sku]).catch(()=>{});
    await db.query("DELETE FROM inventory_adjustments WHERE product_id IN(SELECT id FROM products WHERE sku=$1) AND reason='초기 데이터 이관'",[sku]).catch(()=>{});
    await db.query('DELETE FROM inventory_balances WHERE warehouse_id IN(SELECT id FROM warehouses WHERE code=$1)',[warehouseCode]).catch(()=>{});
    await db.query('DELETE FROM products WHERE sku=$1',[sku]).catch(()=>{});
    await db.query('DELETE FROM warehouses WHERE code=$1',[warehouseCode]).catch(()=>{});
    await db.query('DELETE FROM suppliers WHERE code=$1',[supplierCode]).catch(()=>{});
    await db.query('DELETE FROM customers WHERE code=$1',[customerCode]).catch(()=>{});
    await db.end().catch(()=>{});
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1});

