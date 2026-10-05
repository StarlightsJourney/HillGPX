import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' });

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

test('map category bar scrolls and a card opens its venue page in a new tab', async ({ page, context }) => {
  await page.goto('/#map');
  await dismissNotice(page);
  // On a phone the list covers the map until "Show map"; the canvas is laid out but hidden.
  await page.waitForSelector('.maplibregl-canvas', { state: 'attached', timeout: 15_000 });
  await page.waitForSelector('.result-card', { timeout: 15_000 });

  await expect(page.locator('.categories')).toBeVisible();
  await expect(page.locator('.category').first()).toBeVisible();

  const [venue] = await Promise.all([context.waitForEvent('page'), page.locator('a.result-card[target="_blank"]').first().click()]);
  await dismissNotice(venue);
  await expect(venue.getByRole('heading', { name: 'About this place' })).toBeVisible({ timeout: 15_000 });
  await expect(venue.getByRole('button', { name: /Report an issue with this place/i })).toBeVisible();
  await expect(venue.getByRole('button', { name: 'Back' })).toHaveCount(0);
});

test('header keeps the logo, search, + and units on one row on a phone', async ({ page }) => {
  await page.goto('/#map');
  const box = (selector: string) => page.locator(selector).first().boundingBox();
  const [mark, pill, cta, units] = await Promise.all([box('.site-header .wordmark'), box('.site-header [role="search"]'), box('.site-header-cta'), box('.units-toggle')]);
  for (const item of [mark, pill, cta, units]) expect(item).not.toBeNull();
  const middle = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (const item of [pill!, cta!, units!]) expect(Math.abs(middle(item) - middle(mark!))).toBeLessThan(4);
  expect(pill!.x).toBeGreaterThan(mark!.x + mark!.width);
  expect(pill!.x + pill!.width).toBeLessThan(cta!.x);
  expect(pill!.width).toBeGreaterThan(150);
});

test('landing route opens a compact map panel that expands', async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  // Route tiles are buttons; place tiles are links and skeletons are plain boxes.
  await page.locator('button.tile').first().click();

  const panel = page.locator('.route-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/compact/);
  await expect(page.getByRole('button', { name: 'Download GPX' })).toBeVisible();
  await expect(panel.locator('.gpx-stats').first()).toBeVisible();

  await page.getByRole('button', { name: 'Show more route details' }).click();
  await expect(panel).toHaveClass(/expanded/);
  await page.getByRole('button', { name: 'Show fewer route details' }).click();
  await expect(panel).toHaveClass(/compact/);
});
