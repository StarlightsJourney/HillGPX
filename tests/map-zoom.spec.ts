import { test, expect, type Page } from '@playwright/test';

type TestWindow = { map: { getZoom: () => number; getMaxZoom: () => number; jumpTo: (o: { zoom: number }) => void } };

async function openMap(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // Committed routes only: the test does not depend on what the community has uploaded.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
  // A phone shows the list first; the map is one tap away.
  const showMap = page.getByRole('button', { name: /Show map/ }).first();
  if (await showMap.isVisible().catch(() => false)) await showMap.click();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible({ timeout: 15_000 });
}

const zoom = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).map.getZoom());

test('the + and − buttons zoom the map, at the bottom right, 44 px each', async ({ page }) => {
  await openMap(page, 1280, 800);
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  const [inBox, outBox, mapBox] = [await zoomIn.boundingBox(), await zoomOut.boundingBox(), await page.locator('.maplibregl-map').first().boundingBox()];
  expect(inBox!.width).toBeGreaterThanOrEqual(44);
  expect(inBox!.height).toBeGreaterThanOrEqual(44);
  // Bottom right of the map, with locate, 3D and expand still up at the top right.
  expect(inBox!.x + inBox!.width).toBeGreaterThan(mapBox!.x + mapBox!.width - 40);
  expect(outBox!.y + outBox!.height).toBeGreaterThan(mapBox!.y + mapBox!.height - 100);
  await expect(page.locator('.maplibregl-ctrl-top-right button')).toHaveCount(3);

  const before = await zoom(page);
  await zoomIn.click();
  await expect.poll(() => zoom(page)).toBeGreaterThan(before + 0.5);
  const zoomed = await zoom(page);
  await zoomOut.click();
  await expect.poll(() => zoom(page)).toBeLessThan(zoomed - 0.5);
});

test('at the zoom limit the button is dimmed, marked aria-disabled and stays focusable', async ({ page }) => {
  await openMap(page, 1280, 800);
  await page.evaluate(() => {
    const { map } = window as unknown as TestWindow;
    map.jumpTo({ zoom: map.getMaxZoom() });
  });
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled says "nothing more to zoom", but the button itself is not disabled, so focus stays.
  expect(await zoomIn.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);
  await zoomIn.focus();
  await expect(zoomIn).toBeFocused();
});

test('on a phone the buttons ride above the route panel docked along the bottom', async ({ page }) => {
  await openMap(page, 390, 844);
  await page.locator('.route-item .result-card').first().evaluate((el) => (el as HTMLElement).click());
  const panel = page.getByRole('region', { name: /^Route:/ });
  await expect(panel).toBeVisible();
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  await expect.poll(async () => {
    const [z, p] = [await zoomOut.boundingBox(), await panel.boundingBox()];
    return z!.y + z!.height <= p!.y + 1;
  }).toBe(true);
});
