import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' });

test('map category bar scrolls and detail opens on mobile', async ({ page }) => {
  await page.goto('/#map');
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });

  await expect(page.locator('.categories')).toBeVisible();
  await expect(page.locator('.category').first()).toBeVisible();

  await page.locator('.result-card').first().click();
  await expect(page.getByRole('heading', { name: 'About this place' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Report an issue with this place/i })).toBeVisible();
});

test('header search spans its own row on a phone', async ({ page }) => {
  await page.goto('/#map');
  const pill = await page.locator('.site-header [role="search"]').boundingBox();
  expect(pill).not.toBeNull();
  // 12px gutters either side of a 390px screen.
  expect(Math.round(pill!.x)).toBe(12);
  expect(Math.round(pill!.width)).toBe(390 - 24);
});

test('landing route opens a map panel with download and collapse', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tile').first().click();

  const panel = page.locator('.route-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download GPX' })).toBeVisible();

  await page.getByRole('button', { name: 'Hide route details' }).click();
  await expect(panel.locator('.gpx-stats')).toBeHidden();
  await page.getByRole('button', { name: 'Show route details' }).click();
  await expect(panel.locator('.gpx-stats')).toBeVisible();
});
