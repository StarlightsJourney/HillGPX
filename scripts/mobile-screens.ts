import { chromium, devices } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await context.newPage();
  await page.goto('http://localhost:5180/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/tmp/hillgpx-mobile-landing.png', fullPage: true });
  await page.click('.home-hero-chip');
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/hillgpx-mobile-map.png', fullPage: false });
  await page.click('.result-card, .venue-card');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/hillgpx-mobile-detail.png', fullPage: true });
  await browser.close();
})();
