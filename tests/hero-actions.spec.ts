import { test, expect, type Page } from '@playwright/test';

/** The first-visit open-source card is modal; tests that are not about it close it. */
async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

const search = (page: Page) => page.getByLabel('Search countries, hills, routes, blocks and streets');
const actions = (page: Page) => page.locator('.trail-hero-actions');

test('hero offers Routes near me, Search by Region and Upload GPX', async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  await expect(actions(page).getByRole('button', { name: 'Routes near me' })).toBeVisible();
  await expect(actions(page).getByRole('button', { name: 'Search by Region' })).toBeVisible();
  await expect(actions(page).getByRole('link', { name: 'Upload GPX' })).toBeVisible();
  await expect(actions(page)).not.toContainText('Browse the map');
});

test('Search by Region scrolls up and opens the header search with suggestions', async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  await page.evaluate(() => window.scrollTo(0, 200));
  await actions(page).getByRole('button', { name: 'Search by Region' }).click();
  await expect(search(page)).toBeFocused();
  const suggestions = page.locator('.site-header .searchbar-results');
  await expect(suggestions).toBeVisible();
  await expect(suggestions.getByRole('button', { name: /Singapore/ }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  // Typing goes straight into the box.
  await page.keyboard.type('japan');
  await expect(search(page)).toHaveValue('japan');
});

test('Search by Region jumps without a smooth scroll under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await dismissNotice(page);
  await page.evaluate(() => window.scrollTo(0, 200));
  await actions(page).getByRole('button', { name: 'Search by Region' }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(search(page)).toBeFocused();
});

test('Upload GPX in the hero opens the upload dialog', async ({ page }) => {
  await page.goto('/');
  await dismissNotice(page);
  await actions(page).getByRole('link', { name: 'Upload GPX' }).click();
  await expect(page.getByRole('dialog', { name: 'Upload GPX' })).toBeVisible({ timeout: 15_000 });
});

test('hero buttons stack without overflow on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await dismissNotice(page);
  const buttons = actions(page).locator('.btn');
  await expect(buttons).toHaveCount(3);
  const boxes = await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(375);
  }
  expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
  expect(boxes[2].top).toBeGreaterThanOrEqual(boxes[1].bottom);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
