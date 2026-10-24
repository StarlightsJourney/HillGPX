import { test, expect, type Page } from '@playwright/test';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

// One community route, around Marina Bay: with the two committed Singapore
// routes it makes a cluster of three at country zoom.
const bayLoop = {
  slug: 'bay-flat-loop',
  name: 'Bay Flat Loop',
  activity: 'run',
  recorded_at: null,
  distance_m: 21_100,
  gain_m: 80,
  loss_m: 80,
  elevation_source: 'gps',
  venue_slugs: [],
  points: [
    [103.855, 1.28, 5],
    [103.902, 1.28, 6],
    [103.902, 1.327, 9],
    [103.855, 1.327, 7],
    [103.855, 1.28, 5],
  ],
  gpx_path: 'bay-flat-loop.gpx',
  contributor: 'Test',
  licence: 'CC-BY-4.0',
  downloads: 0,
  created_at: '2026-10-01T00:00:00Z',
};

const pin = (page: Page, slug: string) => page.locator(`.route-pin[data-slug="${slug}"]`);

test('zoomed out to a country, routes are start pins and clusters; a cluster zooms in, a pin opens its route', async ({ page }) => {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [bayLoop] }));
  await page.goto('/#routes');
  await dismissNotice(page);
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Search countries, hills, blocks and streets').fill('malaysia');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.mode-tab.on')).toHaveText('Routes');

  // Singapore's starts merge into one pill with a count; none has a pin of its own.
  await expect(page.locator('.route-cluster', { hasText: /^\d+ routes$/ }).first()).toBeVisible({ timeout: 15_000 });
  await expect(pin(page, 'southern-ridges-walk')).toBeHidden();
  await expect(pin(page, 'bay-flat-loop')).toBeHidden();

  // Each tap zooms to where the cluster splits; keep tapping until it has.
  // The pills move while the camera eases, so each try waits for it to settle.
  await expect(async () => {
    if (await pin(page, 'southern-ridges-walk').isVisible()) return;
    await page.locator('.route-cluster').first().click({ timeout: 2_000 });
    await page.waitForTimeout(1_500);
    await expect(pin(page, 'southern-ridges-walk')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  await pin(page, 'southern-ridges-walk').click();
  await expect(page.getByRole('region', { name: 'Route: Southern Ridges Walk' })).toBeVisible();
});
