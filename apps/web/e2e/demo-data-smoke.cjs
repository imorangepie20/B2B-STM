const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const pg = require('pg');
const { chromium, expect } = require('@playwright/test');

const webOrigin = 'http://127.0.0.1:3101';
const credentialsPath = path.resolve(__dirname, '../../../.demo-credentials.json');
const screenshotsPath = path.resolve(__dirname, '../../../docs/screenshots');
const digest = value => createHash('sha256').update(value).digest('hex');

async function login(page, account, expectedPath) {
  await page.goto(webOrigin, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL(`${webOrigin}${expectedPath}`);
}

async function assertNoHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
}

(async () => {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/b2b_stm');
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const adminToken = randomBytes(32).toString('hex');

  try {
    await db.connect();
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at) VALUES($1,'d0000024-0000-4000-8000-000000000000',now()+interval '1 hour',now(),now())", [digest(adminToken)]);

    const customer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await login(customer, credentials.accounts.customer, '/portal/orders');
    await customer.goto(`${webOrigin}/portal/orders/history`, { waitUntil: 'networkidle' });
    await expect(customer.getByRole('heading', { name: '주문 내역' })).toBeVisible();
    await expect(customer.getByText('DEMO-CUTLERY').first()).toBeVisible();
    await customer.getByRole('button', { name: /#D0000201/ }).click();
    await expect(customer.getByText('DEMO-CUP-12').first()).toBeVisible();
    await assertNoHorizontalOverflow(customer);
    await customer.screenshot({ path: path.join(screenshotsPath, 'demo-customer-order-history.png'), fullPage: true });
    await customer.context().close();

    const warehouse = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(warehouse, credentials.accounts.warehouse, '/warehouse/shipments');
    await expect(warehouse.getByRole('heading', { name: '출고 작업' })).toBeVisible();
    await expect(warehouse.getByText('성수카페 강남점').first()).toBeVisible();
    await expect(warehouse.getByText('소담베이커리').first()).toBeVisible();
    await expect(warehouse.getByText('키친랩 성수')).toHaveCount(0);
    await warehouse.getByRole('button', { name: /#D0000202/ }).click();
    await expect(warehouse.getByLabel(/피킹 수량/).first()).toHaveValue('4');
    await expect(warehouse.getByLabel(/검수 수량/).first()).toHaveValue('2');
    await assertNoHorizontalOverflow(warehouse);
    await warehouse.screenshot({ path: path.join(screenshotsPath, 'demo-warehouse-queue-mobile.png'), fullPage: true });
    await warehouse.context().close();

    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await adminContext.addCookies([{ name: 'b2b_session', value: adminToken, url: webOrigin, httpOnly: true, sameSite: 'Lax' }]);
    const admin = await adminContext.newPage();
    await admin.goto(`${webOrigin}/admin`, { waitUntil: 'networkidle' });
    await expect(admin.getByRole('heading', { name: '운영 현황' })).toBeVisible();
    await expect(admin.getByRole('option', { name: /DEMO-CUP-12/ })).toBeAttached();
    await admin.goto(`${webOrigin}/admin/orders`, { waitUntil: 'networkidle' });
    await expect(admin.getByRole('heading', { name: '주문 관리' })).toBeVisible();
    await expect(admin.getByText('키친랩 성수').first()).toBeVisible();
    await expect(admin.getByText('취소 요청').first()).toBeVisible();
    await assertNoHorizontalOverflow(admin);
    await admin.screenshot({ path: path.join(screenshotsPath, 'demo-admin-orders.png'), fullPage: true });
    await adminContext.close();

    console.log('Demo browser verification passed: customer history, warehouse queue, admin operations');
  } finally {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(adminToken)]).catch(() => {});
    await db.end().catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
