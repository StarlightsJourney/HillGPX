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

test('choosing a need ranks routes straight away at Mount Faber, and re-ranks on edit', async ({ browser }) => {
  const context = await browser.newContext({ geolocation: { latitude: 1.2741, longitude: 103.8196 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await openRoutes(page);

  // 45 min is the default: picking Rolling alone ranks, with no button to press.
  const planner = page.getByRole('region', { name: 'Plan a run' });
  await expect(planner.getByRole('button', { name: 'Rank routes' })).toHaveCount(0);
  await planner.getByLabel('What kind').selectOption({ label: 'Rolling' });

  // Only what is within 10 km: Southern Ridges, UTSG and the stubbed loop.
  await expect(page.locator('.results-head h2')).toHaveText('3 routes for 45 min, rolling, near you');
  await expect(firstCard(page).locator('.result-card-name')).toHaveText('Southern Ridges Walk');
  // Ranked cards look like any other: no match label or reasons line.
  await expect(firstCard(page).locator('.result-badge')).toHaveText(/^(Easy|Moderate|Hard|Brutal)$/);
  await expect(firstCard(page).locator('.result-card-gain')).toContainText('EG');

  // A flat half marathon: the loop now fits best.
  await planner.getByLabel('How long').selectOption({ label: 'Half marathon' });
  await planner.getByLabel('What kind').selectOption({ label: 'Flat' });
  await expect(firstCard(page).locator('.result-card-name')).toHaveText('Bay Flat Loop');

  // Clearing goes back to plain browsing.
  await planner.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.results-head h2')).not.toContainText('near you');
  await expect(planner.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await context.close();
});

test('without location the run planner ranks the country from the time zone, and says so', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Singapore' });
  const page = await context.newPage();
  await openRoutes(page);
  await page.getByRole('region', { name: 'Plan a run' }).getByRole('button', { name: 'Where: near me' }).click();
  await expect(page.locator('.locate-hint')).toContainText('Ranking routes in Singapore instead.');
  await expect(page.locator('.results-head h2')).toContainText('in Singapore');
  await context.close();
});
