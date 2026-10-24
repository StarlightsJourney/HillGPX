import { test, expect, type Browser, type Page } from '@playwright/test';

/** The first-visit open-source card is modal; tests that are not about it close it. */
async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

/**
 * Routes near me from Ayer Hitam, Johor: nothing within 10 km, so the map
 * shows the closest within 50 km with an informational note (no retry).
 */
async function openWidenedNote(browser: Browser) {
  const context = await browser.newContext({ geolocation: { latitude: 1.9216, longitude: 103.1806 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await page.clock.install();
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Show routes near me' }).click();
  const note = page.locator('.locate-hint');
  await expect(note).toContainText('No routes within 10 km');
  return { context, page, note };
}

test('an informational note closes by itself, paused while hovered', async ({ browser }) => {
  const { context, page, note } = await openWidenedNote(browser);
  await note.hover();
  await page.clock.fastForward(8_000);
  await expect(note).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(8_000);
  await expect(note).toHaveCount(0);
  await context.close();
});

test('panning the map closes an informational note straight away', async ({ browser }) => {
  const { context, page, note } = await openWidenedNote(browser);
  const canvas = await page.locator('.maplibregl-canvas').boundingBox();
  const x = canvas!.x + canvas!.width / 2;
  const y = canvas!.y + 80;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(note).toHaveCount(0);
  await context.close();
});

test('the country note shown without a location closes by itself', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Singapore' });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Show routes near me' }).click();
  const note = page.locator('.locate-hint');
  await expect(note).toContainText('Showing routes in Singapore');
  await expect(note).not.toHaveClass(/\bretry\b/);
  await page.clock.fastForward(8_000);
  await expect(note).toHaveCount(0);
  await context.close();
});

test('a note that asks for location again does not close by itself', async ({ browser }) => {
  // No location and a time zone that names no country: nothing to show instead, so the note asks again.
  const context = await browser.newContext({ timezoneId: 'UTC' });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Show routes near me' }).click();
  const note = page.locator('.locate-hint.retry');
  await expect(note).toBeVisible();
  await page.clock.fastForward(20_000);
  await expect(note).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss location hint' }).click();
  await expect(note).toHaveCount(0);
  await context.close();
});
