const { chromium, expect } = require('@playwright/test');
const { createHash, randomBytes } = require('node:crypto');
const pg = require('pg');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const operationsToken = randomBytes(32).toString('hex');
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto('http://127.0.0.1:3101');
    await expect(page.getByRole('heading', { name: '업무 시스템에 로그인' })).toBeVisible();
    await expect(page.getByLabel('이메일')).toBeVisible();
    await expect(page.getByLabel('비밀번호')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Mobile horizontal overflow');
    for (const path of ['/admin', '/portal/orders', '/warehouse/shipments']) {
      await page.goto(`http://127.0.0.1:3101${path}`);
      await expect(page).toHaveURL('http://127.0.0.1:3101/');
      await expect(page.getByRole('heading', { name: '업무 시스템에 로그인' })).toBeVisible();
    }
    await db.connect();
    const operations = await db.query("SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.email LIKE 'demo.%@stm.local' AND r.role='operations' LIMIT 1");
    if (!operations.rowCount) throw new Error('DEMO operations account is required');
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at) VALUES($1,$2,now()+interval '5 minutes',now(),now())", [createHash('sha256').update(operationsToken).digest('hex'), operations.rows[0].id]);
    const operationsContext = await browser.newContext();
    await operationsContext.addCookies([{ name: 'b2b_session', value: operationsToken, url: 'http://127.0.0.1:3101', httpOnly: true, sameSite: 'Lax' }]);
    const operationsPage = await operationsContext.newPage();
    for (const path of ['/admin/accounts', '/admin/account-security']) {
      await operationsPage.goto(`http://127.0.0.1:3101${path}`);
      await expect(operationsPage).toHaveURL('http://127.0.0.1:3101/admin');
      await expect(operationsPage.getByRole('heading', { name: '운영 현황' })).toBeVisible();
    }
    await operationsContext.close();
    console.log('PASS: login screen is accessible and mobile-safe');
  } finally {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [createHash('sha256').update(operationsToken).digest('hex')]).catch(() => {});
    await db.end().catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
