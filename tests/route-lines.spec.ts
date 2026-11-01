import { test, expect, type Page } from '@playwright/test';

type TestWindow = {
  map: {
    getLayer: (id: string) => unknown;
    getPaintProperty: (layer: string, name: string) => unknown;
    getFeatureState: (target: { source: string; id: string }) => { hover?: boolean; selected?: boolean };
  };
};

async function openMap(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Committed routes only: the test does not depend on what the community has uploaded.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as TestWindow).map?.getLayer('routes-line')));
}

const state = (page: Page, slug: string) =>
  page.evaluate((id) => (window as unknown as TestWindow).map.getFeatureState({ source: 'routes', id }), slug);

test('at rest the map draws no route lines, and the lines cannot be hovered or tapped', async ({ page }) => {
  await openMap(page);
  // A line is opaque only where hover or selected is set; everything else is 0.
  const opacity = JSON.stringify(await page.evaluate(() => (window as unknown as TestWindow).map.getPaintProperty('routes-line', 'line-opacity')));
  expect(opacity).toBe('["case",["any",["boolean",["feature-state","hover"],false],["boolean",["feature-state","selected"],false]],1,0]');
  const casing = JSON.stringify(await page.evaluate(() => (window as unknown as TestWindow).map.getPaintProperty('routes-casing', 'line-opacity')));
  expect(casing).toBe(opacity);
  expect(await page.evaluate(() => Boolean((window as unknown as TestWindow).map.getLayer('routes-hit')))).toBe(false);
});

test('a route shows when its row in the list is hovered, and hides again', async ({ page }) => {
  await openMap(page);
  await page.locator('.route-item .result-card').first().hover();
  // Whichever route that row is, exactly one route is lit.
  await expect
    .poll(() => page.evaluate(() => {
      const w = window as unknown as TestWindow & { map: { querySourceFeatures: (s: string) => { properties: { slug: string } }[] } };
      const slugs = new Set(w.map.querySourceFeatures('routes').map((f) => f.properties.slug));
      return [...slugs].filter((s) => w.map.getFeatureState({ source: 'routes', id: s }).hover).length;
    }))
    .toBe(1);
  await page.mouse.move(5, 400);
  await expect
    .poll(() => page.evaluate(() => {
      const w = window as unknown as TestWindow & { map: { querySourceFeatures: (s: string) => { properties: { slug: string } }[] } };
      const slugs = new Set(w.map.querySourceFeatures('routes').map((f) => f.properties.slug));
      return [...slugs].filter((s) => w.map.getFeatureState({ source: 'routes', id: s }).hover).length;
    }))
    .toBe(0);
});

test('hovering a pill lights its route, clicking it opens the route, and moving over the bare map lights nothing', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => (window as unknown as { map: { jumpTo: (o: object) => void } }).map.jumpTo({ center: [103.82, 1.33], zoom: 11.6 }));
  const pin = page.locator('.pin-anchor:not(.is-hidden) .route-pin').first();
  await expect(pin).toBeVisible({ timeout: 15_000 });
  const slug = await pin.getAttribute('data-slug');
  expect(slug).toBeTruthy();
  const map = await page.locator('.maplibregl-canvas').boundingBox();
  for (let i = 0; i < 10; i++) await page.mouse.move(map!.x + 80 + i * 30, map!.y + 60 + i * 30, { steps: 2 });
  expect((await state(page, slug!)).hover ?? false).toBe(false);
  await pin.hover();
  await expect.poll(async () => (await state(page, slug!)).hover ?? false).toBe(true);
  await pin.click();
  await expect(page.getByRole('region', { name: /^Route:/ })).toBeVisible();
  await expect.poll(async () => (await state(page, slug!)).selected ?? false).toBe(true);
});
