const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const pg = require('pg');
const { chromium, expect } = require('@playwright/test');

const webOrigin = 'http://127.0.0.1:3101';
const screenshotsPath = path.resolve(__dirname, '../../../docs/screenshots/recent-pages');
const reportPath = path.resolve(__dirname, '../../../docs/overview/recent-pages-visual-qa.json');
const digest = value => createHash('sha256').update(value).digest('hex');

const roles = {
  admin: {
    userId: '9ea2eb6c-3b10-40d2-869e-1cce826f44ab',
    pages: [
      ['/admin', '운영 현황', 'admin-dashboard'],
      ['/admin/accounts', '계정 관리', 'admin-accounts'],
      ['/admin/account-security', '계정 보안', 'admin-account-security'],
      ['/admin/audit-events', '감사 로그', 'admin-audit-events'],
      ['/admin/notifications', '업무 알림', 'admin-notifications'],
      ['/admin/inventory-adjustments', '재고 정정', 'admin-inventory-adjustments'],
      ['/admin/stock-counts', '재고 실사', 'admin-stock-counts'],
      ['/admin/return-credits', '반품 차감 · 불량 처리', 'admin-return-credits'],
      ['/admin/order-history', '주문 이력', 'admin-order-history'],
      ['/admin/settlements', '정산 조회 · 거래명세서', 'admin-settlements'],
      ['/admin/payments', '입금 · 배분', 'admin-payments'],
      ['/admin/refunds', '실제 환불', 'admin-refunds'],
    ],
  },
  warehouse: {
    userId: 'd0000023-0000-4000-8000-000000000000',
    pages: [
      ['/warehouse/shipments', '출고 작업', 'warehouse-shipments'],
      ['/warehouse/deliveries', '배송 관리', 'warehouse-deliveries'],
      ['/warehouse/returns', '반품 검수 대기', 'warehouse-returns'],
    ],
  },
  customer: {
    userId: 'd0000021-0000-4000-8000-000000000000',
    pages: [
      ['/portal/orders/history', '주문 내역', 'portal-order-history'],
      ['/portal/settlements', '정산 · 입금 내역', 'portal-settlements'],
    ],
  },
};

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function verifyPage(browser, token, route, heading, name, viewportName, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: 'b2b_session', value: token, url: webOrigin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (response.url().startsWith(webOrigin) && response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  try {
    const response = await page.goto(`${webOrigin}${route}`, { waitUntil: 'networkidle' });
    assert(response?.ok(), `${route} document request failed`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const bodyStyle = getComputedStyle(document.body);
      return {
        scrollWidth: root.scrollWidth,
        viewportWidth: window.innerWidth,
        bodyFontFamily: bodyStyle.fontFamily,
        bodyFontSize: bodyStyle.fontSize,
      };
    });
    assert(metrics.scrollWidth <= metrics.viewportWidth, `${route} overflows by ${metrics.scrollWidth - metrics.viewportWidth}px`);
    assert.match(metrics.bodyFontFamily, /Geist/i, `${route} does not use Geist`);
    assert.deepEqual(consoleErrors, [], `${route} console errors`);
    assert.deepEqual(failedRequests, [], `${route} failed internal requests`);
    if (route === '/admin' && viewportName === 'mobile') {
      await page.locator('[data-sidebar="trigger"]').click();
      const drawer = page.locator('[data-mobile="true"]');
      await expect(drawer).toBeVisible();
      const drawerBox = await drawer.boundingBox();
      assert(drawerBox && drawerBox.width <= 257, `mobile sidebar is too wide: ${drawerBox?.width}px`);
      const close = drawer.locator('[data-slot="sheet-close"]');
      await expect(close).toBeVisible();
      await close.click();
      await expect(drawer).toBeHidden();
      await page.locator('[data-sidebar="trigger"]').click();
      await expect(drawer).toBeVisible();
      await drawer.locator('a[href="/admin"]').click();
      await expect(drawer).toBeHidden();
    }
    const chartCounts = { '/admin': 5, '/admin/inventory-adjustments': 2, '/admin/stock-counts': 1, '/admin/return-credits': 2, '/admin/order-history': 2, '/admin/settlements': 2, '/admin/payments': 2, '/admin/refunds': 1, '/warehouse/shipments': 2, '/warehouse/returns': 2, '/portal/orders/history': 2, '/portal/settlements': 2 };
    if (chartCounts[route]) {
      const charts = page.locator('[data-slot="chart"]');
      await expect(charts).toHaveCount(chartCounts[route]);
      await expect(charts.first().locator('svg')).toBeVisible();
      const tooltipRoutes = new Set(['/admin', '/admin/inventory-adjustments', '/admin/order-history', '/admin/settlements', '/warehouse/shipments', '/portal/orders/history']);
      if (viewportName === 'desktop' && tooltipRoutes.has(route)) {
        const tooltip = page.locator('[data-slot="chart-tooltip-content"]');
        const marks = charts.first().locator('.recharts-rectangle, .recharts-sector');
        for (let index = 0; index < Math.min(await marks.count(), 10) && !(await tooltip.isVisible()); index += 1) {
          const box = await marks.nth(index).boundingBox();
          if (box && box.width > 1 && box.height > 1) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(100); }
        }
        if (!(await tooltip.isVisible())) {
          const wrapper = await charts.first().locator('.recharts-wrapper').boundingBox();
          if (wrapper) for (const ratio of [0.25, 0.5, 0.75]) { await page.mouse.move(wrapper.x + wrapper.width * ratio, wrapper.y + wrapper.height * 0.5); await page.waitForTimeout(100); if (await tooltip.isVisible()) break; }
        }
        await expect(tooltip).toBeVisible();
      }
    }
    await page.screenshot({ path: path.join(screenshotsPath, `${name}-${viewportName}.png`), fullPage: true });
    return { route, heading, viewport: viewportName, ...metrics, consoleErrors, failedRequests, passed: true };
  } finally {
    await context.close();
  }
}

(async () => {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/b2b_stm');
  await mkdir(screenshotsPath, { recursive: true });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const browser = await chromium.launch({ headless: true });
  const sessions = Object.fromEntries(Object.keys(roles).map(role => [role, randomBytes(32).toString('hex')]));
  const report = [];

  try {
    await db.connect();
    for (const [role, config] of Object.entries(roles)) {
      const user = await db.query('SELECT active FROM users WHERE id=$1', [config.userId]);
      assert.equal(user.rows[0]?.active, true, `${role} visual QA account is unavailable`);
      await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,mfa_verified_at) VALUES($1,$2,now()+interval '1 hour',now(),now())", [digest(sessions[role]), config.userId]);
    }

    for (const [role, config] of Object.entries(roles)) {
      for (const [route, heading, name] of config.pages) {
        for (const [viewportName, viewport] of Object.entries(viewports)) {
          report.push(await verifyPage(browser, sessions[role], route, heading, name, viewportName, viewport));
          console.log(`PASS ${viewportName.padEnd(7)} ${route}`);
        }
      }
    }

    await writeFile(reportPath, `${JSON.stringify({ checkedAt: new Date().toISOString(), webOrigin, results: report }, null, 2)}\n`, 'utf8');
    console.log(`Visual QA passed: ${report.length}/${report.length} page/viewport checks`);
  } finally {
    if (db._connected) {
      for (const token of Object.values(sessions)) {
        await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]).catch(() => {});
      }
    }
    await db.end().catch(() => {});
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
