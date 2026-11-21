import { test, expect, type Page } from '@playwright/test';

const LONG = 'Coastal Ridge Traverse Through Every Park Connector, Reservoir Trail And Hidden Staircase Loop';

const community = (slug: string, name: string) => ({
  slug,
  name,
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
  gpx_path: `${slug}.gpx`,
  contributor: 'Test',
  licence: 'CC-BY-4.0',
  downloads: 0,
  created_at: '2026-10-01T00:00:00Z',
});

async function openRoute(page: Page, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [community('title-test-route', name)] }));
  await page.goto('/#route/title-test-route');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.getByRole('region', { name: /^Route:/ })).toBeVisible({ timeout: 20_000 });
}

const heading = (page: Page) => page.locator('.route-panel-title h2');

for (const [label, width, height] of [['375 px phone', 375, 812], ['1280 px desktop', 1280, 800]] as const) {
  test(`${label}: a long name wraps to two lines with … and opens in full when tapped`, async ({ page }) => {
    await openRoute(page, LONG, width, height);
    const text = heading(page).locator('.route-name');
    // The full name is always there for hover and for screen readers.
    await expect(heading(page)).toHaveAttribute('title', LONG);
    await expect(text).toHaveText(LONG);

    const toggle = heading(page).getByRole('button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const line = await text.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    const shut = (await text.boundingBox())!.height;
    expect(shut).toBeLessThanOrEqual(line * 2 + 1);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect((await text.boundingBox())!.height).toBeGreaterThan(shut);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await text.boundingBox())!.height).toBeLessThanOrEqual(line * 2 + 1);
  });
}

test('a name that fits is plain text, not a button', async ({ page }) => {
  await openRoute(page, 'Bay Flat Loop', 1280, 800);
  await expect(heading(page)).toContainText('Bay Flat Loop');
  await expect(heading(page).getByRole('button')).toHaveCount(0);
});

test('nothing in the panel title or the places it passes moves by itself', async ({ page }) => {
  await openRoute(page, LONG, 375, 812);
  await expect(page.locator('.marquee-line, .marquee-line-track')).toHaveCount(0);
  const state = () => page.evaluate(() => {
    const text = document.querySelector('.route-name') as HTMLElement;
    const animated = [...document.querySelectorAll('.route-panel-title *, .route-passes *')].filter((el) => getComputedStyle(el).animationName !== 'none').length;
    const box = text.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), animated };
  });
  // The panel slides in when a route opens; the title is measured once that has settled.
  await page.waitForTimeout(1_500);
  const first = await state();
  await page.waitForTimeout(2_500);
  const later = await state();
  expect(later).toEqual(first);
  expect(first.animated).toBe(0);
});
