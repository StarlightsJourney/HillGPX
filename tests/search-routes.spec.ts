import { test, expect, type Page } from '@playwright/test';

// A community route named after a place the geocoder places abroad: Photon
// answers "utown night walk" with a street called Night Walk in England.
const utownWalk = {
  slug: 'utown-night-walk',
  name: 'UTown Night Walk',
  activity: 'run',
  recorded_at: null,
  distance_m: 2_400,
  gain_m: 18,
  loss_m: 18,
  elevation_source: 'gps',
  venue_slugs: [],
  points: [
    [103.7726, 1.3036, 20],
    [103.7745, 1.3052, 26],
    [103.7722, 1.3068, 30],
    [103.7726, 1.3036, 20],
  ],
  gpx_path: 'utown-night-walk.gpx',
  contributor: 'Test',
  licence: 'CC-BY-4.0',
  downloads: 0,
  created_at: '2026-10-01T00:00:00Z',
};

async function stub(page: Page): Promise<string[]> {
  const geocoded: string[] = [];
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [utownWalk] }));
  await page.route('https://photon.komoot.io/**', (route) => {
    geocoded.push(route.request().url());
    return route.fulfill({ json: { features: [] } });
  });
  return geocoded;
}

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

const search = (page: Page) => page.getByRole('searchbox', { name: /Search countries/ });

test('a route name is suggested and opens that route, without asking the geocoder', async ({ page }) => {
  const geocoded = await stub(page);
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });

  await search(page).fill('utown night walk');
  await expect(page.locator('.searchbar-results .result-row', { hasText: 'UTown Night Walk' })).toContainText('Route');
  await search(page).press('Enter');

  await expect(page.locator('.route-panel')).toContainText('UTown Night Walk');
  expect(geocoded).toEqual([]);
});

test('from the landing page, a route search opens the map on that route', async ({ page }) => {
  const geocoded = await stub(page);
  await page.goto('/');
  await dismissNotice(page);
  await search(page).fill('night walk utown');
  await page.locator('.searchbar-results .result-row', { hasText: 'UTown Night Walk' }).click();

  await expect(page).toHaveURL(/#map/);
  await expect(page.locator('.route-panel')).toContainText('UTown Night Walk', { timeout: 20_000 });
  expect(geocoded).toEqual([]);
});
