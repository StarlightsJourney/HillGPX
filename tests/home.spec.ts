import { test, expect, type Page } from '@playwright/test';

/** The first-visit open-source card is modal; tests that are not about it close it. */
async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

test('landing loads with search, rows and the open-source notice', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-header [role="search"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /free to use and open source/i })).toBeVisible();
  await dismissNotice(page);
  await expect(page.locator('.home-row-title', { hasText: 'Routes worth running' })).toBeVisible({ timeout: 15_000 });
});

test('opening the map renders tiles without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await dismissNotice(page);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('typing a country and pressing Search opens that country on its routes', async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  await page.getByLabel('Search countries, hills, blocks and streets').fill('japan');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/#map$/);
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15_000 });
  await expect(page.locator('.mode-tab.on')).toHaveText('Routes', { timeout: 15_000 });
});

test('a search with no routes in the area falls back to climbs', async ({ page }) => {
  // Committed routes only: community uploads could put a route anywhere.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await page.getByLabel('Search countries, hills, blocks and streets').fill('norway');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.mode-tab.on')).toHaveText('Climbs');
});

test('Routes near me opens the map on the routes around you', async ({ browser }) => {
  // Mount Faber, on the Southern Ridges walk.
  const context = await browser.newContext({ geolocation: { latitude: 1.2741, longitude: 103.8196 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await page.goto('/');
  await dismissNotice(page);
  await page.getByRole('button', { name: 'Show routes near me' }).click();
  await expect(page.locator('.mode-tab.on')).toHaveText('Routes', { timeout: 15_000 });
  await expect(page).toHaveURL(/#map$/);
  await context.close();
});

test('landing has the hero and at most 8 rows, then a link to the map', async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  await expect(page.getByRole('heading', { level: 1, name: 'May the trail be with you' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'How it works' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'See every country on the map' })).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.home-row').count()).toBeLessThanOrEqual(8);
  await expect(page.locator('.goal-bar, .marquee')).toHaveCount(0);
});

test('header search never runs under the buttons on a wide window', async ({ page }) => {
  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const pill = await page.locator('.site-header [role="search"]').boundingBox();
    const cta = await page.locator('.site-header-cta').boundingBox();
    const locate = await page.locator('.site-header .locate-btn').boundingBox();
    expect(pill!.x + pill!.width, `at ${width}px`).toBeLessThanOrEqual(cta!.x);
    expect(locate!.x + locate!.width, `at ${width}px`).toBeLessThanOrEqual(pill!.x);
  }
});

test("What's mapped opens from the footer", async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  await page.getByRole('button', { name: "What's mapped" }).click();
  await expect(page.getByRole('dialog', { name: "What's mapped" })).toBeVisible({ timeout: 15_000 });
});

test('Add a GPX on a venue page opens the dialog over that page', async ({ page }) => {
  await page.goto('/#venue/bukit-timah-hill');
  await page.locator('.venue-detail .site-header-cta').click();
  await expect(page.getByRole('dialog', { name: 'Add a GPX route' })).toBeVisible();
  await expect(page).toHaveURL(/#venue\/bukit-timah-hill$/);
  await expect(page.locator('.venue-detail')).toBeVisible();
});

test('map page footer spans the page below both the list and the map', async ({ page }) => {
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await expect(page.locator('.list-pane .site-footer')).toHaveCount(0);
  const footer = page.locator('.app > .site-footer');
  await expect(footer).toHaveCount(1);
  await expect(footer).not.toBeInViewport();
  const map = await page.locator('.map-wrap').boundingBox();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const box = await footer.boundingBox();
  // The page's width, not the window's: html reserves a scrollbar gutter.
  expect(box!.width).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  expect(box!.y).toBeGreaterThanOrEqual(map!.y);
});
