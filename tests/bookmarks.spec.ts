import { test, expect, type Page } from '@playwright/test';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

async function openRoutes(page: Page) {
  const routesTab = page.getByRole('tab', { name: 'Routes', exact: true });
  await routesTab.click();
  await expect(routesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
}

test('a hearted route is listed under Saved and survives a reload', async ({ page }) => {
  // Community routes stubbed out so only the committed routes show.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#map');
  await dismissNotice(page);
  await openRoutes(page);

  // No bookmarks yet: no Saved category.
  await expect(page.getByRole('tab', { name: 'Saved', exact: true })).toHaveCount(0);

  const card = page.locator('.route-item').first();
  const name = (await card.locator('.result-card-name').textContent())!.trim();
  const heart = card.getByRole('button', { name: `Save ${name}` });
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');

  const saved = page.getByRole('tab', { name: 'Saved', exact: true });
  await saved.click();
  await expect(page.locator('.route-item')).toHaveCount(1);
  await expect(page.locator('.route-item .result-card-name')).toHaveText(name);
  // Bookmarks are not GPX files saved on the device.
  await expect(page.getByRole('tab', { name: 'On this device', exact: true })).toHaveCount(0);

  await page.reload();
  await dismissNotice(page);
  await openRoutes(page);
  await page.getByRole('tab', { name: 'Saved', exact: true }).click();
  await expect(page.locator('.route-item .result-card-name')).toHaveText(name);
  await expect(page.locator('.route-item').getByRole('button', { name: `Save ${name}` })).toHaveAttribute('aria-pressed', 'true');

  // The route panel's heart shows the same state and un-bookmarks.
  await page.locator('.route-item .result-card').click();
  const panelHeart = page.locator('.gpx-panel-actions').getByRole('button', { name: `Save ${name}` });
  await expect(panelHeart).toHaveAttribute('aria-pressed', 'true');
  await panelHeart.click();
  await expect(panelHeart).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('hillgpx:routeBookmarks'))).toBe('[]');
});
