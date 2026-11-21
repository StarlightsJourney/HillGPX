import { test, expect, type Page } from '@playwright/test';

type Win = { map: { project: (lngLat: [number, number]) => { x: number; y: number } } };

test.use({ viewport: { width: 1440, height: 900 } });

async function openRoutes(page: Page) {
  // Committed routes only: the test does not depend on what the community has uploaded.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
}

const row = (page: Page, name: string) => page.locator('.route-item .result-card', { hasText: name });
const card = (page: Page) => page.locator('.map-wrap .route-panel');
const more = (page: Page) => page.getByRole('button', { name: 'Show more route details' });
const fewer = (page: Page) => page.getByRole('button', { name: 'Show fewer route details' });

test('a route opens as a card over the map, with the list kept beside it', async ({ page }) => {
  await openRoutes(page);
  await row(page, 'Southern Ridges').click();
  await expect(card(page)).toBeVisible();
  await expect(page.locator('.list-pane .route-panel')).toHaveCount(0);
  await expect(page.locator('.route-item').first()).toBeVisible();
});

test('More details docks the details into the left column; Fewer details floats the card back', async ({ page }) => {
  await openRoutes(page);
  await row(page, 'Southern Ridges').click();
  await more(page).click();

  // Docked: the details replace the list, every detail is open and nothing floats over the map.
  const docked = page.locator('.list-pane .route-panel.in-sidebar');
  await expect(docked).toBeVisible();
  await expect(docked).toHaveClass(/expanded/);
  await expect(page.locator('.map-wrap .route-panel')).toHaveCount(0);
  await expect(page.locator('.route-item')).toHaveCount(0);
  await expect(fewer(page)).toBeVisible();
  await expect(docked).toContainText('Southern Ridges');
  await expect(page.locator('.route-end-start')).toHaveCount(1);

  await fewer(page).click();
  await expect(card(page)).toBeVisible();
  await expect(page.locator('.list-pane .route-panel')).toHaveCount(0);
  await expect(card(page)).toContainText('Southern Ridges');
});

test('after All routes, the next route opens as a card again, not docked', async ({ page }) => {
  await openRoutes(page);
  await row(page, 'Southern Ridges').click();
  await more(page).click();
  await expect(page.locator('.list-pane .route-panel.in-sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'All routes' }).click();
  await page.mouse.move(5, 400);

  await row(page, 'UTSG 60km').click();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('UTSG 60km');
  await expect(page.locator('.list-pane .route-panel')).toHaveCount(0);
  await expect(page.locator('.route-item').first()).toBeVisible();
  // Docking is asked for each time.
  await more(page).click();
  await expect(page.locator('.list-pane .route-panel.in-sidebar')).toBeVisible();
});

test('docked, All routes returns to the list and leaves no markers behind', async ({ page }) => {
  await openRoutes(page);
  await row(page, 'Southern Ridges').click();
  await more(page).click();
  await page.getByRole('button', { name: 'All routes' }).click();
  // The list comes back under the pointer, and a hovered row shows its markers: look away first.
  await page.mouse.move(5, 400);
  await expect(page.locator('.list-pane .route-panel')).toHaveCount(0);
  await expect(page.locator('.route-item').first()).toBeVisible();
  await expect(page.locator('.route-end')).toHaveCount(0);
});

test('where only the card fits, More details opens in place', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await openRoutes(page);
  await row(page, 'Southern Ridges').click();
  const region = page.getByRole('region', { name: /^Route:/ });
  await expect(region).toBeVisible();
  await more(page).click();
  await expect(region).toHaveClass(/expanded/);
  await expect(page.locator('.list-pane .route-panel')).toHaveCount(0);
  await expect(page.locator('.map-wrap .route-panel')).toBeVisible();
});

test('docking and floating back re-fit the whole route to the space that is left', async ({ page, request }) => {
  await openRoutes(page);
  const data = (await (await request.get('/data/routes.json')).json()) as { routes: { slug: string; coordinates: [number, number, number][] }[] };
  const coordinates = data.routes.find((route) => route.slug === 'southern-ridges-walk')!.coordinates.map(([lng, lat]) => [lng, lat]);

  /** The route's left and right edges on the map, in pixels from the map's left edge, and the map's width. */
  const spread = () =>
    page.evaluate((points) => {
      const { map } = window as unknown as Win;
      const box = document.querySelector('.maplibregl-map')!.getBoundingClientRect();
      const xs = (points as [number, number][]).map((point) => map.project(point).x);
      return { left: Math.min(...xs), right: Math.max(...xs), width: box.width };
    }, coordinates);

  await row(page, 'Southern Ridges').click();
  await page.waitForTimeout(1_800); // the camera finishes framing the route beside the card
  const floating = await spread();
  // Beside the card the route keeps clear of its left side.
  expect(floating.left).toBeGreaterThan(300);

  await more(page).click();
  await page.waitForTimeout(1_800);
  const docked = await spread();
  // Nothing covers the map now: the route fits the whole of it, edge to edge with a margin.
  expect(docked.left).toBeGreaterThanOrEqual(0);
  expect(docked.right).toBeLessThanOrEqual(docked.width);
  expect(docked.left).toBeLessThan(floating.left - 150);

  await fewer(page).click();
  await page.waitForTimeout(1_800);
  const back = await spread();
  expect(back.left).toBeGreaterThan(300);
});
