import { test, expect, type Page } from '@playwright/test';

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

async function openMap(page: Page): Promise<string[]> {
  const geocoded: string[] = [];
  await page.route('https://photon.komoot.io/**', (route) => {
    geocoded.push(route.request().url());
    return route.fulfill({ json: { features: [] } });
  });
  await page.goto('/#map');
  await dismissNotice(page);
  await page.waitForSelector('.result-card', { timeout: 15_000 });
  return geocoded;
}

const search = (page: Page) => page.getByRole('searchbox', { name: /Search countries/ });
const rows = (page: Page) => page.locator('.searchbar-results .result-row');

test('a Singapore neighbourhood is suggested as you type and found without the geocoder', async ({ page }) => {
  const geocoded = await openMap(page);
  await search(page).fill('buona vista');
  await expect(rows(page).first()).toContainText('Buona Vista');
  await expect(rows(page).first()).toContainText('Neighbourhood · Queenstown');

  await search(page).press('Enter');
  await expect(page.locator('.searchbar-results')).toHaveCount(0);
  expect(geocoded).toEqual([]);
});

test('a planning area shows once, with its URA boundary rather than the block town', async ({ page }) => {
  await openMap(page);
  await search(page).fill('queenstown');
  await expect(rows(page).filter({ hasText: /^Queenstown/ })).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Planning area · Singapore');
});

test('"one north" finds one-north', async ({ page }) => {
  await openMap(page);
  await search(page).fill('one north');
  await expect(rows(page).first()).toContainText('one-north');
});
