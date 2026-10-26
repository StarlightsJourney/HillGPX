import { test, expect, type Page } from '@playwright/test';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

const firstName = (page: Page) => page.locator('.result-card .result-card-name').first();

// #20: fitting Singapore's short, wide box pulls Johor in at the edges, and
// Gunung Pulai (654 m) outranked Bukit Timah Hill (163 m).
test('searching Singapore lists Singapore first, and panning away ranks as before', async ({ page }) => {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await dismissNotice(page);
  await page.getByLabel('Search countries, hills, routes, blocks and streets').fill('singapore');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/#map$/);
  // Singapore has routes, so search opens on them; the places are under Climbs.
  await expect(page.locator('.mode-tab.on')).toHaveText('Routes', { timeout: 15_000 });
  await page.locator('.mode-tab', { hasText: 'Climbs' }).click();
  await expect(firstName(page)).toHaveText('Bukit Timah Hill', { timeout: 15_000 });

  // Drag the map by hand until its centre is over Johor, with Gunung Pulai in
  // view: the searched box no longer applies, so Pulai (654 m, with a photo)
  // leads again, as it did before.
  const canvas = page.locator('.maplibregl-canvas');
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * 0.3, y + box.height * 0.45, { steps: 12 });
  await page.mouse.up();
  await expect(firstName(page)).toHaveText('Gunung Pulai', { timeout: 15_000 });
});
