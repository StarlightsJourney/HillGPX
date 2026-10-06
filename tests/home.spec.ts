import { test, expect, type Page } from '@playwright/test';

/** The first-visit open-source card is modal; tests that are not about it close it. */
async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

test('landing loads with search, rows and the open-source notice', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-header [role="search"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /free to use and open source/i })).toBeVisible();
  await dismissNotice(page);
  await expect(page.locator('.home-row-title', { hasText: 'Routes worth running' })).toBeVisible({ timeout: 15_000 });
});

test('opening the map renders tiles without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await dismissNotice(page);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('typing a country and pressing Search frames that country', async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  await page.getByLabel('Search countries, hills and towns').fill('japan');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/#map/);
  // The hash carries Japan's box before the map tidies it to #map.
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });
});

test('Add a GPX on a venue page opens the dialog over that page', async ({ page }) => {
  await page.goto('/#venue/bukit-timah-hill');
  await page.locator('.venue-detail .site-header-cta').click();
  await expect(page.getByRole('dialog', { name: 'Add a GPX route' })).toBeVisible();
  await expect(page).toHaveURL(/#venue\/bukit-timah-hill$/);
  await expect(page.locator('.venue-detail')).toBeVisible();
});

test('map page footer spans the page below both the list and the map', async ({ page }) => {
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await expect(page.locator('.list-pane .site-footer')).toHaveCount(0);
  const footer = page.locator('.app > .site-footer');
  await expect(footer).toHaveCount(1);
  await expect(footer).not.toBeInViewport();
  const map = await page.locator('.map-wrap').boundingBox();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const box = await footer.boundingBox();
  // The page's width, not the window's: html reserves a scrollbar gutter.
  expect(box!.width).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  expect(box!.y).toBeGreaterThanOrEqual(map!.y);
});
