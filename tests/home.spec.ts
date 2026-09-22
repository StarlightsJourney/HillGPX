import { test, expect } from '@playwright/test';

test('landing loads and shows the search experience', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Find your next vertical, anywhere.')).toBeVisible();
  await expect(page.locator('[role="search"]')).toBeVisible();
  await expect(page.locator('.home-hero-stats')).toContainText('venues');
  await expect(page.locator('.home-hero-stats')).toContainText('routes');
});

test('opening the map renders tiles without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await page.click('.home-hero-chip');
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });
  expect(errors).toEqual([]);
});
