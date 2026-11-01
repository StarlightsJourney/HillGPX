import { test, expect, type Page } from '@playwright/test';

type Win = { map: { project: (lngLat: [number, number]) => { x: number; y: number } } };

async function openRoutes(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Committed routes only: the test does not depend on what the community has uploaded.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
}

const row = (page: Page, name: string) => page.locator('.route-item .result-card', { hasText: name });

test('markers appear on the open route only: ring at the start, flag at the finish, gone when it closes', async ({ page, request }) => {
  await openRoutes(page);
  await expect(page.locator('.route-end')).toHaveCount(0);

  await row(page, 'Southern Ridges').click();
  await expect(page.getByRole('region', { name: /^Route:/ })).toBeVisible();
  await expect(page.locator('.route-end-start')).toHaveCount(1);
  await expect(page.locator('.route-end-finish')).toHaveCount(1);
  await expect(page.locator('.route-end-loop')).toHaveCount(0);

  // The ring is centred on the first point; the flag's pole base is on the last.
  const data = (await (await request.get('/data/routes.json')).json()) as { routes: { slug: string; coordinates: [number, number, number][] }[] };
  const { coordinates } = data.routes.find((route) => route.slug === 'southern-ridges-walk')!;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  await page.waitForTimeout(1_600); // the camera finishes framing the route
  const where = await page.evaluate(([a, b]) => {
    const { map } = window as unknown as Win;
    const origin = document.querySelector('.maplibregl-map')!.getBoundingClientRect();
    const start = document.querySelector('.route-end-start')!.getBoundingClientRect();
    const finish = document.querySelector('.route-end-finish')!.getBoundingClientRect();
    const [pa, pb] = [map.project(a as [number, number]), map.project(b as [number, number])];
    return {
      start: [start.x + start.width / 2 - origin.x - pa.x, start.y + start.height / 2 - origin.y - pa.y],
      finish: [finish.x + 5 - origin.x - pb.x, finish.y + finish.height - 3 - origin.y - pb.y],
    };
  }, [[first[0], first[1]], [last[0], last[1]]]);
  for (const offset of [...where.start, ...where.finish]) expect(Math.abs(offset)).toBeLessThan(2);

  // Markers never take a tap: the map and the pins underneath stay clickable.
  for (const kind of ['start', 'finish']) {
    expect(await page.locator(`.route-end-${kind}`).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  }

  await page.getByRole('button', { name: 'Close route' }).click();
  await expect(page.locator('.route-end')).toHaveCount(0);
});

test('a loop gets one loop marker, not two on top of each other', async ({ page }) => {
  await openRoutes(page);
  await row(page, 'UTSG 60km').click();
  await expect(page.locator('.route-end-loop')).toHaveCount(1);
  await expect(page.locator('.route-end-start, .route-end-finish')).toHaveCount(0);
  await expect(page.locator('.route-legend')).toContainText('Start and finish');
});

test('selecting another route moves the markers; hovering a row shows them while the pointer is on it', async ({ page }) => {
  await openRoutes(page);
  await row(page, 'Southern Ridges').click();
  await expect(page.locator('.route-end-start')).toHaveCount(1);
  await row(page, 'UTSG 60km').click();
  await expect(page.locator('.route-end-loop')).toHaveCount(1);
  await expect(page.locator('.route-end-start')).toHaveCount(0);

  await page.getByRole('button', { name: 'Close route' }).click();
  await expect(page.locator('.route-end')).toHaveCount(0);
  await row(page, 'Southern Ridges').hover();
  await expect(page.locator('.route-end-start')).toHaveCount(1);
  await page.mouse.move(5, 400);
  await expect(page.locator('.route-end')).toHaveCount(0);
});

test('the keyboard selects a route the same way, and the panel says what is marked', async ({ page }) => {
  await openRoutes(page);
  await row(page, 'Southern Ridges').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.route-end-start')).toHaveCount(1);
  // The markers live on the map, where a screen reader cannot see them, so the panel says so.
  await expect(page.getByRole('status').filter({ hasText: 'selected. Start and finish are marked on the map.' })).toHaveCount(1);
  await expect(page.locator('.route-legend')).toContainText('Start');
  await expect(page.locator('.route-legend')).toContainText('Finish');
  // The open route keeps its pin, lifted just above the ring so neither hides the other.
  const pin = page.locator('.route-pin.is-selected');
  await expect(pin).toBeVisible();
  const [pinBox, ringBox] = [await pin.boundingBox(), await page.locator('.route-end-start').boundingBox()];
  expect(pinBox!.y + pinBox!.height).toBeLessThanOrEqual(ringBox!.y + 4);
});
