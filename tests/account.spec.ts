import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/**
 * The signed-in account area against a stubbed Supabase: a fake session in
 * storage and canned REST answers. Screenshots go to the temp folder, never
 * the repo.
 */
const SHOTS = '/tmp/hillgpx-account';
mkdirSync(SHOTS, { recursive: true });

const REF = 'dzpgnebkyubeptitzjlj';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function session() {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: USER_ID, role: 'authenticated', exp })}.sig`,
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: exp,
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'ridge@example.com',
      created_at: '2026-03-02T00:00:00Z',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { username: 'ridge_runner' },
      identities: [{ provider: 'google' }],
    },
  };
}

const row = (slug: string, name: string, gain: number, dist: number, downloads: number, createdAt: string) => ({
  slug,
  name,
  activity: 'run',
  recorded_at: null,
  distance_m: dist,
  gain_m: gain,
  loss_m: gain,
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
  contributor: 'ridge_runner',
  licence: 'CC-BY-4.0',
  downloads,
  anonymous: false,
  created_at: createdAt,
});

const MINE = [
  row('bay-flat-loop', 'Bay Flat Loop', 80, 21_100, 12, '2026-10-01T00:00:00Z'),
  row('faber-hill-repeats', 'Faber Hill Repeats', 410, 8_400, 31, '2026-09-12T00:00:00Z'),
];

interface Setup {
  mine?: typeof MINE;
  savedRoutes?: string[];
  savedPlaces?: string[];
}

async function signIn(page: Page, { mine = MINE, savedRoutes = [], savedPlaces = [] }: Setup = {}) {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
      sessionStorage.setItem('hillgpx:openSourceNoticeSeen', '1');
    },
    [`sb-${REF}-auth-token`, JSON.stringify(session())],
  );
  await page.route(`https://${REF}.supabase.co/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith('/rest/v1/profiles')) {
      if (method === 'PATCH') return route.fulfill({ status: 204, body: '' });
      return route.fulfill({ json: [{ id: USER_ID, username: 'ridge_runner', avatar_path: null }] });
    }
    if (url.pathname.endsWith('/rest/v1/routes')) {
      if (url.search.includes('user_id=eq')) return route.fulfill({ json: mine });
      return route.fulfill({ json: mine });
    }
    if (url.pathname.endsWith('/rest/v1/saved_items')) {
      if (method !== 'GET') return route.fulfill({ status: 204, body: '' });
      return route.fulfill({
        json: [...savedRoutes.map((slug) => ({ kind: 'route', slug })), ...savedPlaces.map((slug) => ({ kind: 'place', slug }))],
      });
    }
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: session().user });
    if (url.pathname.includes('/rpc/route_downloads')) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
}

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 900 } });

test('avatar menu opens with counts and goes to each destination', async ({ page }) => {
  await signIn(page, { savedRoutes: ['bay-flat-loop'], savedPlaces: ['bukit-timah-hill'] });
  await page.goto('/#account');
  await page.getByRole('button', { name: 'Account: ridge_runner' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Your routes\s*2/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Saved\s*2/ })).toBeVisible();
  await page.waitForTimeout(400); // let the pop-in settle before the screenshot
  await page.screenshot({ path: `${SHOTS}/menu.png`, clip: { x: 800, y: 0, width: 480, height: 420 } });
  await menu.getByRole('menuitem', { name: /Settings/ }).click();
  await expect(page).toHaveURL(/#settings\/profile$/);
});

test('populated profile: units, sorting, stats and opening a route on the map', async ({ page }) => {
  await signIn(page);
  await page.goto('/#account');
  await expect(page.getByRole('heading', { name: 'ridge_runner', level: 1 })).toBeVisible();
  await expect(page.locator('.ac-stats')).toContainText('490 m');
  await expect(page.locator('.ac-stats')).toContainText('43');
  await expect(page.getByRole('link', { name: 'Your routes' })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: `${SHOTS}/profile-populated-metric.png`, fullPage: true });

  await page.getByRole('button', { name: /Switch to feet/ }).click();
  await expect(page.locator('.ac-stats')).toContainText('1608 ft');
  await page.screenshot({ path: `${SHOTS}/profile-populated-imperial.png`, fullPage: true });
  await page.getByRole('button', { name: /Switch to metres/ }).click();

  await page.getByRole('button', { name: 'Most downloaded' }).click();
  await expect(page.locator('.ac-row').first()).toContainText('Faber Hill Repeats');

  await page.getByRole('link', { name: /^Stats/ }).click();
  await expect(page).toHaveURL(/#account\/stats$/);
  await expect(page.locator('.ac-hero-number')).toHaveText('490 m');
  await expect(page.getByText('of climbing shared across 2 routes')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/stats-overview.png`, fullPage: true });
  await page.getByRole('link', { name: 'By route' }).click();
  await expect(page).toHaveURL(/#account\/stats\/routes$/);
  await page.screenshot({ path: `${SHOTS}/stats-by-route.png`, fullPage: true });

  await page.goto('/#account');
  await page.getByRole('button', { name: /Open Faber Hill Repeats on the map/ }).click();
  await expect(page).toHaveURL(/#map$/);
  await expect(page.locator('.route-panel-title')).toContainText('Faber Hill Repeats', { timeout: 20_000 });
});

test('empty profile', async ({ page }) => {
  await signIn(page, { mine: [] });
  await page.goto('/#account');
  await expect(page.getByRole('heading', { name: 'Your first climb is waiting' })).toBeVisible();
  await expect(page.getByText('Saves sync to your account.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/profile-empty.png`, fullPage: true });

  // The empty-state switch is the same setting as the header's.
  await page.getByRole('radio', { name: 'Imperial' }).click();
  await expect(page.getByRole('button', { name: /Switch to metres/ })).toBeVisible();

  await page.goto('/#account/stats');
  await expect(page.getByText('Your climbing adds up here')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/stats-empty.png`, fullPage: true });
});

test('saved panel: both tabs open the map on the item', async ({ page }) => {
  await signIn(page, { savedRoutes: ['bay-flat-loop'], savedPlaces: ['bukit-timah-hill'] });
  await page.goto('/#account/saved');
  await expect(page.getByRole('tab').or(page.getByRole('link', { name: /Routes \(1\)/ }))).toBeVisible();
  await expect(page.getByText('Saved to your account and synced to every device you sign in on.')).toBeVisible();
  await expect(page.locator('.ac-row')).toContainText('Bay Flat Loop');
  await page.screenshot({ path: `${SHOTS}/saved-routes.png`, fullPage: true });

  await page.getByRole('link', { name: /Places \(1\)/ }).click();
  await expect(page).toHaveURL(/#account\/saved\/places$/);
  await expect(page.locator('.ac-row')).toContainText('Bukit Timah Hill');
  await page.screenshot({ path: `${SHOTS}/saved-places.png`, fullPage: true });
  await page.getByRole('button', { name: /Open Bukit Timah.* on map/ }).click();
  await expect(page).toHaveURL(/#map$/);
  await expect(page.locator('.venue-card, .result-card.selected, [aria-label*="Bukit Timah"]').first()).toBeVisible({ timeout: 20_000 });
});

test('settings sections have their own addresses and survive a refresh', async ({ page }) => {
  await signIn(page);
  await page.goto('/#settings/preferences');
  await expect(page.getByRole('heading', { name: 'Preferences', level: 2 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Preferences', level: 2 })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/settings-preferences.png`, fullPage: true });

  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/#settings\/account$/);
  await expect(page.getByText('Google is your only sign-in method')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/settings-account.png`, fullPage: true });

  await page.getByRole('link', { name: 'Your data' }).click();
  await page.screenshot({ path: `${SHOTS}/settings-data.png`, fullPage: true });
  await page.goBack();
  await expect(page).toHaveURL(/#settings\/account$/);
});

test('username: invalid, taken-looking and success', async ({ page }) => {
  await signIn(page);
  await page.goto('/#settings/profile');
  const field = page.getByLabel('Username');
  await field.fill('ab');
  await expect(page.getByText('Use at least 3 characters.')).toHaveCount(0);
  await field.blur();
  await expect(page.getByText('Use at least 3 characters.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/settings-profile-invalid.png`, fullPage: true });
  await field.fill('fresh_name');
  await expect(page.getByText('Use at least 3 characters.')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/settings-profile-dirty.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Username updated')).toBeVisible();
});

test('delete account dialog gates on the typed username', async ({ page }) => {
  await signIn(page);
  await page.goto('/#settings/account');
  await page.getByRole('button', { name: 'Delete account…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/delete-dialog.png` });
  const confirm = dialog.getByRole('button', { name: 'Delete account' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/to confirm/).fill('ridge_runner');
  await expect(confirm).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete account…' })).toBeFocused();
});

test('phone width: the columns stack and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  for (const hash of ['#account', '#account/stats', '#settings/profile', '#settings/account']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('.ac-main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${hash} overflows sideways`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/phone-${hash.replace(/[#/]/g, '-')}.png`, fullPage: true });
  }
});
