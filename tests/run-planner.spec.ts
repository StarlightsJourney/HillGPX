import { test, expect, type Page } from '@playwright/test';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

// One community route, so the order is known: a flat half-marathon loop
// around Marina Bay and East Coast, ~4 km from Mount Faber.
const flatLoop = {
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

async function openRoutes(page: Page) {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [flatLoop] }));
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await page.locator('.mode-tab', { hasText: 'Routes' }).click();
}

const firstCard = (page: Page) => page.locator('.route-item').first();

test('Near me ranks the routes within 5 km of Mount Faber, closest first', async ({ browser }) => {
  const context = await browser.newContext({ geolocation: { latitude: 1.2741, longitude: 103.8196 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await openRoutes(page);

  // Nothing locates until the chip is tapped: no ranking, no Clear.
  const planner = page.getByRole('region', { name: 'Routes near me' });
  await expect(planner.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await planner.getByRole('button', { name: 'Where: near me' }).click();

  // Only what is within 5 km: the Kluang run (~70 km away) is left out.
  await expect(page.locator('.results-head h2')).toContainText('routes near you');
  await expect(firstCard(page).locator('.result-card-name')).toHaveText('Southern Ridges Walk');
  await expect(page.locator('.result-card-name', { hasText: 'Kluang' })).toHaveCount(0);
  // Ranked cards look like any other: no match label or reasons line.
  await expect(firstCard(page).locator('.result-badge')).toHaveText(/^(Easy|Moderate|Hard|Brutal)$/);
  await expect(firstCard(page).locator('.result-card-gain')).toContainText('EG');

  // Clearing goes back to plain browsing.
  await planner.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.results-head h2')).not.toContainText('near you');
  await expect(planner.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await context.close();
});

test('without location Near me ranks the country from the time zone, and says so', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Singapore' });
  const page = await context.newPage();
  await openRoutes(page);
  await page.getByRole('region', { name: 'Routes near me' }).getByRole('button', { name: 'Where: near me' }).click();
  await expect(page.locator('.locate-hint')).toContainText('Ranking routes in Singapore instead.');
  await expect(page.locator('.results-head h2')).toContainText('in Singapore');
  await context.close();
});
