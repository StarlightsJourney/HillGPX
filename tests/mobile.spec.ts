import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' });

test('map category bar scrolls and detail opens on mobile', async ({ page }) => {
  await page.goto('/');
  await page.click('.home-hero-chip');
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });

  const categories = page.locator('.categories');
  await expect(categories).toBeVisible();
  const firstChip = page.locator('.category').first();
  await expect(firstChip).toBeVisible();

  // Open the first venue card and verify the bottom sheet/detail renders.
  await page.click('.result-card, .venue-card');
  await expect(page.getByRole('heading', { name: 'Plan a session' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Photos' }).first()).toBeVisible();
});
