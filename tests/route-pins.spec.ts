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
  await page.getByLabel('Search countries, hills, routes, blocks and streets').fill('malaysia');
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

// A dozen short loops starting a few hundred metres apart in the city centre:
// at zoom 11 their pills would sit on top of each other.
const crowd = Array.from({ length: 12 }, (_, i) => {
  const lng = 103.835 + (i % 4) * 0.006;
  const lat = 1.29 + Math.floor(i / 4) * 0.004;
  return {
    ...bayLoop,
    slug: `crowd-${i}`,
    name: `Crowd Loop ${i}`,
    distance_m: 5_000 + i * 1_300,
    gain_m: 20 + i * 10,
    loss_m: 20 + i * 10,
    points: [
      [lng, lat, 5],
      [lng + 0.01, lat, 6],
      [lng + 0.01, lat + 0.01, 9],
      [lng, lat + 0.01, 7],
      [lng, lat, 5],
    ],
    gpx_path: `crowd-${i}.gpx`,
  };
});

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const shownPins = (page: Page) => page.locator('.pin-anchor:not(.is-hidden) .route-pin');

async function expectNoOverlaps(page: Page): Promise<number> {
  const boxes = await shownPins(page).evaluateAll((pins) =>
    pins.map((pin) => {
      const { x, y, width, height } = pin.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) expect(overlap(boxes[i], boxes[j])).toBe(false);
  }
  return boxes.length;
}

async function zoomIn(page: Page) {
  const canvas = (await page.locator('.maplibregl-canvas').first().boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(500);
  }
}

test('zoomed in on a busy city, route pins never cover each other; the hovered and open route keep theirs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: crowd }));
  await page.goto('/#routes');
  await dismissNotice(page);
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Search countries, hills, routes, blocks and streets').fill('singapore');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.mode-tab.on')).toHaveText('Routes');
  await page.waitForTimeout(2_000);

  // Past the clusters, to about zoom 11: some pins give way, the rest are readable.
  await zoomIn(page);
  await expect(page.locator('.route-cluster:visible')).toHaveCount(0, { timeout: 10_000 });
  await expect(async () => {
    expect(await page.locator('.pin-anchor.is-hidden .route-pin[data-slug^="crowd-"]').count()).toBeGreaterThan(0);
    expect(await expectNoOverlaps(page)).toBeGreaterThan(0);
  }).toPass({ timeout: 10_000 });
  const shownBefore = await shownPins(page).count();

  // Hovering a route in the list brings back its pin, even a hidden one.
  const hiddenSlug = (await page
    .locator('.pin-anchor.is-hidden .route-pin[data-slug^="crowd-"]')
    .first()
    .getAttribute('data-slug'))!;
  const hiddenName = crowd.find((route) => route.slug === hiddenSlug)!.name;
  const item = page.locator('.route-item', { hasText: hiddenName });
  await item.hover();
  await expect(pin(page, hiddenSlug)).toBeVisible();
  await expectNoOverlaps(page);

  // Zooming in parts the crowd: more pins show.
  await zoomIn(page);
  await expect(async () => {
    expect(await shownPins(page).count()).toBeGreaterThan(shownBefore);
    await expectNoOverlaps(page);
  }).toPass({ timeout: 10_000 });

  // The open route's pin always shows.
  await item.click();
  await expect(page.getByRole('region', { name: `Route: ${hiddenName}` })).toBeVisible();
  await expect(async () => {
    await expect(pin(page, hiddenSlug)).toBeVisible({ timeout: 1_000 });
    await expectNoOverlaps(page);
  }).toPass({ timeout: 10_000 });
});
