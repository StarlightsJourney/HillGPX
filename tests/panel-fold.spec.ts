import { test, expect, type Page } from '@playwright/test';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

/** Drag the map by hand, away from the panel down the left. */
async function dragMap(page: Page, release = true) {
  // Opening a route from the list can leave the page scrolled; the map is sticky, but start from the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  const canvas = await page.locator('.maplibregl-canvas').boundingBox();
  const x = canvas!.x + canvas!.width - 120;
  const y = canvas!.y + canvas!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y + 50, { steps: 8 });
  if (release) await page.mouse.up();
}

async function openRoutes(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Committed routes only: the test does not depend on what the community has uploaded.
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#routes');
  await dismissNotice(page);
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 15_000 });
}

test('opening and switching routes leaves the panel whole', async ({ page }) => {
  await openRoutes(page);
  const panel = page.locator('.route-panel');
  await page.getByLabel('Search countries, hills, blocks and streets').fill('hong kong');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('.route-item .result-card', { hasText: 'Hong Kong Trail Section 2' }).click();
  await expect(page.getByRole('region', { name: /Route: Hong Kong Trail Section 2/ })).toBeVisible();
  // The app's own flight to the route (1.4 s) must not fold it.
  await page.waitForTimeout(2_000);
  await expect(panel).not.toHaveClass(/\bfolded\b/);

  // The next section starts beside it; its pin flies the camera across.
  await page.locator('.route-pin[data-slug="hong-kong-trail-section-3"]').click();
  await expect(page.getByRole('region', { name: /Route: Hong Kong Trail Section 3/ })).toBeVisible();
  await page.waitForTimeout(2_000);
  await expect(panel).not.toHaveClass(/\bfolded\b/);
});

test('dragging the map folds the panel; it opens again once the map rests, More details intact', async ({ page }) => {
  await openRoutes(page);
  const panel = page.locator('.route-panel');
  await page.locator('.route-item .result-card').first().click();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.getByRole('button', { name: 'Show more route details' }).click();
  await expect(panel).toHaveClass(/expanded/);

  await dragMap(page, false);
  await expect(panel).toHaveClass(/\bfolded\b/);
  // The slim strip: the name and the three numbers, nothing else.
  await expect(panel.locator('.gpx-stat', { hasText: 'Distance' })).toBeVisible();
  await expect(panel.locator('.profile')).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Download GPX' })).toBeHidden();
  // Held still mid-drag, it stays folded: only the end of the move counts.
  await page.waitForTimeout(1_500);
  await expect(panel).toHaveClass(/\bfolded\b/);

  await page.mouse.up();
  await expect(panel).not.toHaveClass(/\bfolded\b/, { timeout: 4_000 });
  await expect(panel).toHaveClass(/expanded/);
  await expect(page.getByRole('button', { name: 'Show fewer route details' })).toBeVisible();
});

test('tapping the folded strip opens it straight away', async ({ page }) => {
  await openRoutes(page);
  const panel = page.locator('.route-panel');
  await page.locator('.route-item .result-card').first().click();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(2_000);

  await dragMap(page, false);
  await expect(panel).toHaveClass(/\bfolded\b/);
  await page.mouse.up();
  await page.locator('.route-panel-unfold').click();
  await expect(panel).not.toHaveClass(/\bfolded\b/);
  await expect(panel.getByRole('button', { name: 'Download GPX' })).toBeVisible();
});
