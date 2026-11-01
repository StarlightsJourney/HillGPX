import { test, expect, type Page } from '@playwright/test';

const SLUG = 'hong-kong-trail-section-2';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

/** Committed routes only: the test does not depend on what the community has uploaded. */
async function stubCommunity(page: Page) {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
}

async function openRoute(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubCommunity(page);
  await page.goto('/#routes');
  await dismissNotice(page);
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Search countries, hills, routes, blocks and streets').fill('hong kong');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('.route-item .result-card', { hasText: 'Hong Kong Trail Section 2' }).click();
  await expect(page.getByRole('region', { name: /Route: Hong Kong Trail Section 2/ })).toBeVisible();
}

test('Share copies a link that opens the route, and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openRoute(page);
  const share = page.getByRole('button', { name: 'Share this route' });
  await expect(share).toBeVisible();
  const box = await share.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(28);
  await share.click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toHaveCount(1);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(`${new URL(page.url()).origin}/#route/${SLUG}`);
  expect(link).not.toMatch(/utm_|\?/);
  // The tick goes back to the share icon by itself.
  await expect(page.getByRole('button', { name: 'Share this route' })).toBeVisible({ timeout: 5_000 });
});

test('with a share sheet, Share hands it the name, numbers and link; cancelling it says nothing', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: unknown[]; __cancel: boolean };
    w.__shared = [];
    w.__cancel = false;
    navigator.share = async (data) => {
      w.__shared.push(data);
      if (w.__cancel) throw new DOMException('Share canceled', 'AbortError');
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openRoute(page);
  await page.getByRole('button', { name: 'Share this route' }).click();
  const shared = (await page.evaluate(() => (window as unknown as { __shared: { title: string; text: string; url: string }[] }).__shared))[0];
  expect(shared.title).toBe('Hong Kong Trail Section 2');
  expect(shared.text).toContain('4.3 km');
  expect(shared.text).toContain('on HillGPX');
  expect(shared.url).toBe(`${new URL(page.url()).origin}/#route/${SLUG}`);
  await expect(page.getByRole('button', { name: 'Link copied' })).toHaveCount(0);

  await page.evaluate(() => ((window as unknown as { __cancel: boolean }).__cancel = true));
  await page.getByRole('button', { name: 'Share this route' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('opening a shared link shows the map with that route open, then keeps an ordinary address', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubCommunity(page);
  await page.goto(`/#route/${SLUG}`);
  await dismissNotice(page);
  await expect(page.getByRole('region', { name: /Route: Hong Kong Trail Section 2/ })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/#routes$/);
  // The route is drawn and the map is framed on it (Hong Kong, not Singapore).
  await expect.poll(() => page.evaluate(() => (window as unknown as { map: { getCenter: () => { lng: number } } }).map.getCenter().lng)).toBeGreaterThan(110);
});

test('a link to a route that is gone opens the map with a note, not an empty panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubCommunity(page);
  await page.goto('/#route/not-a-route-anyone-has');
  await dismissNotice(page);
  await expect(page.getByText("That route isn't available")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('region', { name: /^Route:/ })).toHaveCount(0);
  await expect(page.locator('.route-item').first()).toBeVisible();
});
