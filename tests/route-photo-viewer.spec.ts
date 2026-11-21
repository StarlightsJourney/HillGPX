import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.use({ viewport: { width: 1440, height: 900 } });

// A real committed photo for the wide shape; the repo has no tall one, so that is a drawn picture (a generated fixture, as a fallback).
const LANDSCAPE = readFileSync('public/photos/blk-1-queen-s-road.webp');
const PORTRAIT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000" viewBox="0 0 600 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ec5d8"/><stop offset="0.55" stop-color="#6aa07a"/><stop offset="1" stop-color="#2f5d3f"/></linearGradient></defs><rect width="600" height="1000" fill="url(#g)"/></svg>',
);

// Three along Southern Ridges Walk, a third, half and four fifths of the way (away from its start pill).
const photo = (id: string, kind: 'photo' | 'hazard', caption: string, author: string, path: string, at: [number, number]) => ({
  id,
  route_slug: 'southern-ridges-walk',
  lng: at[0],
  lat: at[1],
  kind,
  caption,
  storage_path: path,
  author,
  created_at: '2026-06-30T08:00:00Z',
});
let rows: ReturnType<typeof photo>[] = [];

test.beforeEach(async ({ request }) => {
  const data = (await (await request.get('/data/routes.json')).json()) as { routes: { slug: string; coordinates: [number, number, number][] }[] };
  const line = data.routes.find((route) => route.slug === 'southern-ridges-walk')!.coordinates;
  const at = (share: number): [number, number] => {
    const point = line[Math.floor(line.length * share)];
    return [point[0], point[1]];
  };
  rows = [
    photo('p1', 'photo', 'Boardwalk through the canopy', 'Stan de Vrieze', 'p1-landscape.webp', at(0.33)),
    photo('p2', 'photo', 'Steps up to the pavilion', 'LN9267', 'p2-portrait.svg', at(0.5)),
    photo('p3', 'hazard', 'Slippery after rain', 'A contributor', 'p3-landscape.webp', at(0.8)),
  ];
});

async function openRoute(page: Page) {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/route_photos**', (route) => route.fulfill({ json: rows }));
  await page.route('**/storage/v1/object/public/photos/**', (route) =>
    route.request().url().includes('portrait')
      ? route.fulfill({ body: PORTRAIT, contentType: 'image/svg+xml' })
      : route.fulfill({ body: LANDSCAPE, contentType: 'image/webp' }),
  );
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await page.locator('.route-item .result-card', { hasText: 'Southern Ridges' }).click();
  await expect(page.locator('.route-photo-pin').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000); // the camera finishes framing the route, so the pins stop moving
}

const pin = (page: Page, caption: string) => page.locator(`.route-photo-pin[aria-label*="${caption}"]`);
const popup = (page: Page) => page.locator('.route-photo-popup');
const viewer = (page: Page) => page.getByRole('dialog', { name: /^Photo:/ });

test('a photo pin opens a card with the whole picture, who added it, and a way to enlarge it', async ({ page }) => {
  await openRoute(page);
  await pin(page, 'Boardwalk through the canopy').click();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page)).toContainText('Boardwalk through the canopy');
  await expect(popup(page)).toContainText('Added by Stan de Vrieze');
  // Never cropped: the picture is contained in its frame, not covering it.
  const fit = await popup(page).locator('.route-photo-pop-frame img').evaluate((el) => getComputedStyle(el).objectFit);
  expect(fit).toBe('contain');
  await expect(popup(page).getByRole('button', { name: 'View photo full screen' })).toBeVisible();
});

for (const caption of ['Slippery after rain', 'Boardwalk through the canopy', 'Steps up to the pavilion']) {
  test(`wherever the photo is, its card opens whole: inside the map, clear of the map buttons, on top of the route panel (${caption})`, async ({ page }) => {
    await openRoute(page);
    await pin(page, caption).click();
    await expect(popup(page)).toBeVisible();
    await page.waitForTimeout(700); // the map pans the card into the clear
    await page.mouse.move(5, 5); // off the panel's elevation chart, whose hover tooltip would sit over the card
    const card = (await popup(page).locator('.route-photo-pop').boundingBox())!;
    const map = (await page.locator('.maplibregl-map').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(map.x);
    expect(card.y).toBeGreaterThanOrEqual(map.y);
    expect(card.x + card.width).toBeLessThanOrEqual(map.x + map.width - 70); // the buttons down the right edge
    expect(card.y + card.height).toBeLessThanOrEqual(map.y + map.height);
    // Where there is no room beside the route panel the card floats over it, but it is always on top: every corner is the card's own.
    const corners: [number, number][] = [[10, 10], [card.width - 10, 10], [10, card.height - 10], [card.width - 10, card.height - 10], [card.width / 2, card.height / 2]];
    for (const [dx, dy] of corners) {
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return { inside: Boolean(el?.closest('.route-photo-popup')), what: el ? `${el.tagName}.${el.className}` : 'nothing' };
      }, [card.x + dx, card.y + dy]);
      expect(hit.inside, `the card is covered at (${dx}, ${dy}) by ${hit.what}`).toBe(true);
    }
  });
}

test('the card’s picture opens the photo full screen, with its author, date and caption', async ({ page }) => {
  await openRoute(page);
  await pin(page, 'Boardwalk through the canopy').click();
  await popup(page).getByRole('button', { name: 'View photo full screen' }).click();

  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page)).toContainText('Stan de Vrieze');
  await expect(viewer(page)).toContainText('Jun 30, 2026');
  await expect(viewer(page)).toContainText('Boardwalk through the canopy');
  const image = viewer(page).getByRole('img', { name: 'Boardwalk through the canopy' });
  await expect(image).toBeVisible();
  // The picture fits the screen whole.
  const box = (await image.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1440);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
});

test('the arrows and keys step through every photo, hazards included, and wrap round', async ({ page }) => {
  await openRoute(page);
  await pin(page, 'Boardwalk through the canopy').click();
  await popup(page).getByRole('button', { name: 'View photo full screen' }).click();
  await expect(viewer(page)).toContainText('1 / 3');

  const names = async () => (await viewer(page).getAttribute('aria-label')) ?? '';
  const first = await names();
  await viewer(page).getByRole('button', { name: 'Next photo' }).click();
  await expect(viewer(page)).toContainText('2 / 3');
  expect(await names()).not.toBe(first);
  await page.keyboard.press('ArrowRight');
  await expect(viewer(page)).toContainText('3 / 3');
  await expect(viewer(page)).toContainText('Hazard');
  await page.keyboard.press('ArrowRight');
  await expect(viewer(page)).toContainText('1 / 3');
  await page.keyboard.press('ArrowLeft');
  await expect(viewer(page)).toContainText('3 / 3');
});

test('a tall photo shows whole too, and Escape closes the viewer but not what is underneath', async ({ page }) => {
  await openRoute(page);
  await pin(page, 'Steps up to the pavilion').click();
  await popup(page).getByRole('button', { name: 'View photo full screen' }).click();
  const image = viewer(page).getByRole('img', { name: 'Steps up to the pavilion' });
  await expect(image).toBeVisible();
  const box = (await image.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(900);
  expect(box.height).toBeGreaterThan(box.width);

  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);
  // The route's panel and the card are still there.
  await expect(page.getByRole('region', { name: /^Route:/ })).toBeVisible();
  await expect(popup(page)).toBeVisible();
});

test('Close returns focus to where the viewer was opened, and Report is in the menu', async ({ page }) => {
  await openRoute(page);
  await pin(page, 'Slippery after rain').click();
  const frame = popup(page).getByRole('button', { name: 'View photo full screen' });
  await frame.click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).getByRole('button', { name: 'Close photo' })).toBeFocused();

  await viewer(page).getByRole('button', { name: 'More' }).click();
  await expect(viewer(page).getByRole('menuitem', { name: 'Report this photo' })).toBeVisible();
  await page.keyboard.press('Escape'); // closes the menu first
  await expect(viewer(page)).toBeVisible();
  await viewer(page).getByRole('button', { name: 'Close photo' }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(frame).toBeFocused();
});

test('on a phone the picture and the arrows fit, and a swipe steps to the next photo', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await openRoute(page);
  await pin(page, 'Boardwalk through the canopy').click();
  await popup(page).getByRole('button', { name: 'View photo full screen' }).click();
  await expect(viewer(page)).toContainText('1 / 3');
  const image = viewer(page).getByRole('img').first();
  const box = (await image.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await viewer(page).dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 300, clientY: 400 }] });
  await viewer(page).dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 100, clientY: 400 }] });
  await expect(viewer(page)).toContainText('2 / 3');
  await context.close();
});
