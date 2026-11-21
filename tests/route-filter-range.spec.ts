import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

// Singapore has two committed routes: Southern Ridges (10.7 km) and UTSG (62.4 km).
async function openFilters(page: Page) {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15_000 });
  await page.getByRole('button', { name: /Filters/ }).click();
  await expect(page.getByRole('dialog', { name: 'Route filters' })).toBeVisible();
}

const rows = (page: Page) => page.locator('.route-item');
const field = (page: Page, name: string) => page.getByRole('textbox', { name });

test('typing a minimum and maximum distance filters the routes and moves the handles', async ({ page }) => {
  await openFilters(page);
  const min = field(page, 'Minimum distance');
  const max = field(page, 'Maximum distance');

  await min.fill('20');
  await min.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('UTSG');
  await expect(page.getByRole('slider', { name: 'Minimum distance' })).toHaveAttribute('aria-valuenow', '20000');
  await expect(min).toHaveValue('20 km');

  // A maximum below the minimum takes the minimum down with it.
  await max.fill('12.5');
  await max.press('Enter');
  await expect(page.getByRole('slider', { name: 'Maximum distance' })).toHaveAttribute('aria-valuenow', '12500');
  await expect(min).toHaveValue('12.5 km');
  await expect(rows(page)).toHaveCount(0);

  // Emptying the minimum lifts it; Southern Ridges (10.7 km) is under 12.5 km.
  await min.fill('');
  await min.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Southern Ridges');
});

test('what cannot be read puts the value back, and says so', async ({ page }) => {
  await openFilters(page);
  const min = field(page, 'Minimum distance');
  await min.fill('soon');
  await min.press('Enter');
  await expect(min).toHaveAttribute('aria-invalid', 'true');
  await expect(min).toHaveValue('0 km');
  await expect(rows(page)).toHaveCount(2);
  // Typing again clears the complaint.
  await min.fill('4');
  await expect(min).not.toHaveAttribute('aria-invalid', 'true');
});

test('Escape in a field puts the value back without closing the dialog; elsewhere it closes it', async ({ page }) => {
  await openFilters(page);
  const min = field(page, 'Minimum distance');
  await min.fill('30');
  await min.press('Escape');
  await expect(min).toHaveValue('0 km');
  await expect(page.getByRole('dialog', { name: 'Route filters' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('dialog', { name: 'Route filters' }).getByRole('heading', { name: 'Route filters' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Route filters' })).toBeHidden();
});

test('a maximum past the top of the track is a real bound; the handle waits at the end', async ({ page }) => {
  await openFilters(page);
  const max = field(page, 'Maximum distance');
  await max.fill('500');
  await max.press('Enter');
  await expect(max).toHaveValue('500 km');
  await expect(page.getByRole('slider', { name: 'Maximum distance' })).toHaveAttribute('aria-valuenow', '500000');
  await expect(rows(page)).toHaveCount(2);
});

test('time and elevation gain take typed values too', async ({ page }) => {
  await openFilters(page);
  // Southern Ridges is ~1 h 45 min (a trail); UTSG ~9 h 15 min.
  const maxTime = field(page, 'Maximum estimated time');
  await maxTime.fill('3h');
  await maxTime.press('Enter');
  await expect(maxTime).toHaveValue('3 h');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Southern Ridges');
  await maxTime.fill('');
  await maxTime.press('Enter');
  await expect(rows(page)).toHaveCount(2);

  const minGain = field(page, 'Minimum elevation gain');
  await minGain.fill('500');
  await minGain.press('Enter');
  await expect(minGain).toHaveValue('500 m');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('UTSG');
});

test('dragging or keying a handle still moves it by stops and updates its field', async ({ page }) => {
  await openFilters(page);
  const handle = page.getByRole('slider', { name: 'Maximum distance' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  const value = Number(await handle.getAttribute('aria-valuenow'));
  expect(value).toBeGreaterThan(0);
  await expect(field(page, 'Maximum distance')).not.toHaveValue(/\+$/);
  await page.keyboard.press('End');
  await expect(field(page, 'Maximum distance')).toHaveValue(/\+?$/);
});

test('the climbs filter takes a typed minimum and maximum height', async ({ page }) => {
  await page.goto('/#map');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Filters/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Filters' });
  await expect(dialog).toBeVisible();
  const apply = dialog.locator('.filter-apply');
  // Every venue is in the pool, so the button starts at its "over 1,000" cap.
  await expect(apply).toContainText('Show over 1,000 venues');

  const min = field(page, 'Minimum height');
  await min.fill('800');
  await min.press('Enter');
  await expect(page.getByRole('slider', { name: 'Minimum height' })).toHaveAttribute('aria-valuenow', '800');
  // The count follows after the dialog's short pause, and is well under the cap.
  await expect(apply).not.toContainText('over 1,000');

  await min.fill('');
  await min.press('Enter');
  await expect(apply).toContainText('Show over 1,000 venues');
});
