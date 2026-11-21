import { test, expect, type Page } from '@playwright/test';

const DEFAULT_TITLE = 'hillGPX: hills and free GPX routes';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

const h1s = (page: Page) => page.locator('h1').evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Committed data only, so what the community has uploaded cannot change a title.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
});

test('landing keeps the default title and has one h1', async ({ page }) => {
  await page.goto('/#');
  await expect(page).toHaveTitle(DEFAULT_TITLE);
  await expect.poll(() => h1s(page)).toHaveLength(1);
});

test('place page: titled by the place, whose name is the only h1', async ({ page }) => {
  await page.goto('/#venue/bukit-timah-hill');
  await dismissNotice(page);
  await expect(page).toHaveTitle('Bukit Timah Hill · hillGPX', { timeout: 20_000 });
  await expect.poll(() => h1s(page)).toEqual(['Bukit Timah Hill']);
});

test('climbs map: "Climbs in {area}", one visually hidden h1 that says the same', async ({ page }) => {
  await page.goto('/#map');
  await dismissNotice(page);
  await expect(page.locator('.mode-tab.on')).toHaveText('Climbs');
  // The map opens on Singapore.
  await expect(page).toHaveTitle('Climbs in Singapore · hillGPX', { timeout: 20_000 });
  await expect.poll(() => h1s(page)).toEqual(['Climbs in Singapore']);
  // Hidden from sight, not from screen readers.
  const box = await page.locator('h1').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);
});

test('routes map: "Routes in {area}"; an open route is titled by its name; closing it goes back', async ({ page }) => {
  await page.goto('/#routes');
  await dismissNotice(page);
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveTitle('Routes in Singapore · hillGPX', { timeout: 20_000 });
  await expect.poll(() => h1s(page)).toEqual(['Routes in Singapore']);

  await page.getByLabel('Search countries, hills, routes, blocks and streets').fill('hong kong');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('.route-item .result-card', { hasText: 'Hong Kong Trail Section 2' }).click();
  await expect(page.getByRole('region', { name: /Route: Hong Kong Trail Section 2/ })).toBeVisible();
  await expect(page).toHaveTitle('Hong Kong Trail Section 2 · hillGPX');
  await expect.poll(() => h1s(page)).toEqual(['Routes in Hong Kong']);

  await page.getByRole('button', { name: 'Close route' }).click();
  await expect(page).toHaveTitle('Routes in Hong Kong · hillGPX');
});

test('info page keeps its tab title and one h1, and leaving restores the default', async ({ page }) => {
  await page.goto('/#privacy');
  await expect(page).toHaveTitle('Privacy · hillGPX');
  await expect.poll(() => h1s(page)).toEqual(['Privacy']);
  await page.evaluate(() => (window.location.hash = '#'));
  await expect(page).toHaveTitle(DEFAULT_TITLE);
});

test('leaving a place for the map swaps its title and heading', async ({ page }) => {
  await page.goto('/#venue/bukit-timah-hill');
  await dismissNotice(page);
  await expect(page).toHaveTitle('Bukit Timah Hill · hillGPX', { timeout: 20_000 });
  await page.evaluate(() => (window.location.hash = '#map'));
  await expect(page).toHaveTitle(/^(Climbs|Routes) (in .+|on the map) · hillGPX$/);
  await expect.poll(() => h1s(page)).toHaveLength(1);
  expect((await h1s(page))[0]).not.toBe('Bukit Timah Hill');
});
