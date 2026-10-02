import { test, expect } from '@playwright/test';

test('landing loads with search, rows and the open-source notice', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-header [role="search"]')).toBeVisible();
  await expect(page.locator('.home-row-title', { hasText: 'Routes worth running' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /free and open source/i })).toBeVisible();
});

test('opening the map renders tiles without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('map page footer sits at the end of the list, not over the map', async ({ page }) => {
  await page.goto('/#map');
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await expect(page.locator('.list-pane > .site-footer')).toHaveCount(1);
  await expect(page.locator('.app > .site-footer')).toHaveCount(0);
  await expect(page.locator('.list-pane > .site-footer')).not.toBeInViewport();
});
