import { test, expect, type Page } from '@playwright/test';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: "We couldn't find that place" });

async function expectNotFoundPage(page: Page) {
  await expect(heading(page)).toBeVisible({ timeout: 20_000 });
  const layer = page.locator('.venue-detail-notfound');
  await expect(layer.locator('.home-search')).toBeVisible();
  await expect(layer.locator('.site-footer')).toBeVisible();
  await expect(layer.getByRole('link', { name: 'Back to the map' })).toHaveAttribute('href', '#map');
  await expect(page.locator('[aria-label="Loading place"]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
});

test('a place link nobody has shows the not-found page, and Back to the map leaves it', async ({ page }) => {
  await page.goto('/#venue/does-not-exist');
  await dismissNotice(page);
  await expectNotFoundPage(page);

  await page.locator('.venue-detail-notfound').getByRole('link', { name: 'Back to the map' }).click();
  await expect(heading(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#map$/);
  await expect(page.locator('.mode-tab.on')).toHaveText('Climbs');
});

test('a world-summit link that matches no summit shows it too', async ({ page }) => {
  await page.goto('/#venue/gn1-1x1');
  await dismissNotice(page);
  await expectNotFoundPage(page);
});

test('while the data is still loading it is the skeleton, never not-found; a real place still opens', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/data/venues.json', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/#venue/bukit-timah-hill');
  await expect(page.locator('[aria-label="Loading place"]')).toBeVisible({ timeout: 15_000 });
  await expect(heading(page)).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Bukit Timah Hill' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(heading(page)).toHaveCount(0);
});

test('a route link nobody has keeps the route note, and an open place card cannot cover it', async ({ page }) => {
  await page.goto('/#route/does-not-exist');
  await dismissNotice(page);
  const note = page.locator('.locate-hint');
  await expect(note).toContainText("That route isn't available", { timeout: 20_000 });
  await expect(page).toHaveURL(/#routes$/);
  await expect(heading(page)).toHaveCount(0);

  // Open a place card from the climbs map while the note is still up. The
  // pointer stays on the note, which pauses its countdown, so the card is
  // opened with a DOM click on its pin.
  await page.locator('.mode-tab', { hasText: 'Climbs' }).click();
  await note.hover();
  await expect(note).toBeVisible();
  const pins = page.locator('.pin-anchor:not(.is-hidden) .pin');
  await expect(pins.first()).toBeVisible({ timeout: 15_000 });
  // The pin lowest on the map puts its card nearest the note.
  const boxes = await pins.evaluateAll((els) => els.map((el, i) => ({ i, y: el.getBoundingClientRect().y })));
  const lowest = boxes.sort((a, b) => b.y - a.y)[0].i;
  await pins.nth(lowest).evaluate((el) => (el as HTMLElement).click());
  const card = page.locator('.maplibregl-popup.venue-popup .venue-card');
  await expect(card).toBeVisible();
  await expect(note).toBeVisible();

  // Wherever the card and the note meet, the note is the one on top.
  const topmostIsNote = await page.evaluate(() => {
    const noteEl = document.querySelector('.locate-hint');
    const cardEl = document.querySelector('.venue-popup .venue-card');
    if (!noteEl || !cardEl) return false;
    const a = noteEl.getBoundingClientRect();
    const b = cardEl.getBoundingClientRect();
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    if (left >= right || top >= bottom) return true; // they do not meet
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return !!hit && noteEl.contains(hit);
  });
  expect(topmostIsNote).toBe(true);
});
