const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const pg = require('pg');
const { chromium, expect } = require('@playwright/test');

const webOrigin = 'http://127.0.0.1:3101';
const digest = value => createHash('sha256').update(value).digest('hex');

const workspaces = [
  { route: '/admin', userId: '9ea2eb6c-3b10-40d2-869e-1cce826f44ab', menu: '주문 관리', mobileTarget: '/admin/orders' },
  { route: '/portal/orders', userId: 'd0000021-0000-4000-8000-000000000000', menu: '주문 내역', mobileTarget: '/portal/orders/history' },
  { route: '/warehouse/shipments', userId: 'd0000023-0000-4000-8000-000000000000', menu: '배송 관리', mobileTarget: '/warehouse/deliveries' },
];

async function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at) VALUES($1,$2,now()+interval '15 minutes',now(),now())",
    [digest(token), userId],
  );
  return token;
}

async function openWorkspace(browser, token, route, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: 'b2b_session', value: token, url: webOrigin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  await page.goto(`${webOrigin}${route}`, { waitUntil: 'networkidle' });
  return { context, page };
}

(async () => {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/b2b_stm');

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const browser = await chromium.launch({ headless: true });
  const tokens = [];

  try {
    await db.connect();

    for (const workspace of workspaces) {
      const token = await createSession(db, workspace.userId);
      tokens.push(token);
      const { context, page } = await openWorkspace(browser, token, workspace.route, { width: 1440, height: 900 });
      try {
        const sidebar = page.locator('[data-slot="sidebar"][data-state]').first();
        await expect(sidebar).toBeVisible();
        await expect(sidebar).toHaveAttribute('data-state', 'expanded');
        await expect(sidebar.getByText(workspace.menu, { exact: true })).toBeVisible();
        await expect(page.getByRole('navigation', { name: '주요 업무' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '메뉴 접기 또는 펼치기' })).toBeVisible();
        await expect(page.locator('header nav[aria-label="breadcrumb"]')).toBeVisible();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${workspace.route} desktop horizontal overflow`);

        const expandedWidth = (await sidebar.boundingBox())?.width ?? 0;
        await page.locator('header [data-sidebar="trigger"]').click();
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
        const collapsedWidth = (await sidebar.boundingBox())?.width ?? expandedWidth;
        assert(collapsedWidth < expandedWidth, `${workspace.route} desktop sidebar did not collapse`);
      } finally {
        await context.close();
      }
    }

    for (const [index, workspace] of workspaces.entries()) {
      const { context, page } = await openWorkspace(browser, tokens[index], workspace.route, { width: 390, height: 844 });
      try {
        await expect(page.locator('[data-mobile="true"]')).toHaveCount(0);
        await page.locator('header [data-sidebar="trigger"]').click();
        const drawer = page.locator('[data-mobile="true"]');
        await expect(drawer).toBeVisible();
        await expect(drawer.getByText(workspace.menu, { exact: true })).toBeVisible();
        await drawer.locator(`a[href="${workspace.mobileTarget}"]`).click();
        await expect(drawer).toBeHidden();
        await expect(page).toHaveURL(`${webOrigin}${workspace.mobileTarget}`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${workspace.route} mobile horizontal overflow`);
      } finally {
        await context.close();
      }
    }

    console.log('PASS: desktop sidebars and mobile drawer share the responsive navigation');
  } finally {
    if (db._connected) {
      for (const token of tokens) await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]).catch(() => {});
    }
    await db.end().catch(() => {});
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
