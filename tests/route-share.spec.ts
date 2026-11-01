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

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Share this route' });

test('Share opens a dialog with the route and a Copy link row that copies a link opening it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openRoute(page);
  const share = page.getByRole('button', { name: 'Share this route' });
  await expect(share).toBeVisible();
  await share.click();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Hong Kong Trail Section 2');
  await expect(dialog(page)).toContainText('4.3 km');
  // No share sheet in this browser: copy and email are the ways to pass it on.
  await expect(dialog(page).getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);

  await dialog(page).getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Link copied' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toHaveCount(1);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(`${new URL(page.url()).origin}/#route/${SLUG}`);
  expect(link).not.toMatch(/utm_|\?/);
  // The tick goes back to the copy icon by itself.
  await expect(dialog(page).getByRole('button', { name: 'Copy link' })).toBeVisible({ timeout: 6_000 });

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  // Back on the route, with focus returned to the Share button.
  await expect(page.getByRole('region', { name: /Route: Hong Kong Trail Section 2/ })).toBeVisible();
  await expect(share).toBeFocused();
});

test('Email opens a message with the route and its link', async ({ page }) => {
  await openRoute(page);
  await page.getByRole('button', { name: 'Share this route' }).click();
  const href = await dialog(page).getByRole('link', { name: 'Email' }).getAttribute('href');
  expect(href).toMatch(/^mailto:\?subject=Hong%20Kong%20Trail%20Section%202&body=/);
  expect(decodeURIComponent(href!)).toContain(`/#route/${SLUG}`);
  expect(decodeURIComponent(href!)).toContain('4.3 km');
});

test('with a share sheet, the Share pill hands it the name, numbers and link; cancelling says nothing', async ({ page }) => {
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

  // Cancelled first: the dialog stays, with no message and no error.
  await page.evaluate(() => ((window as unknown as { __cancel: boolean }).__cancel = true));
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link copied' })).toHaveCount(0);

  await page.evaluate(() => ((window as unknown as { __cancel: boolean }).__cancel = false));
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  const shared = (await page.evaluate(() => (window as unknown as { __shared: { title: string; text: string; url: string }[] }).__shared)).at(-1)!;
  expect(shared.title).toBe('Hong Kong Trail Section 2');
  expect(shared.text).toContain('4.3 km');
  expect(shared.text).toContain('on HillGPX');
  expect(shared.url).toBe(`${new URL(page.url()).origin}/#route/${SLUG}`);
  // Shared: the dialog has done its job.
  await expect(dialog(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the options are clean pills: no bullets, no default button outlines, the main one in the brand colour', async ({ page }) => {
  await openRoute(page);
  await page.getByRole('button', { name: 'Share this route' }).click();
  const copy = dialog(page).getByRole('button', { name: 'Copy link' });
  const email = dialog(page).getByRole('link', { name: 'Email' });
  await expect(copy).toBeVisible();
  const look = (locator: typeof copy) =>
    locator.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: parseFloat(s.borderTopLeftRadius), border: s.borderTopWidth, background: s.backgroundColor, height: el.getBoundingClientRect().height };
    });
  const [main, quiet] = [await look(copy), await look(email)];
  // Pills (fully rounded), 44 px or taller, with no browser-default border.
  for (const pill of [main, quiet]) {
    expect(pill.radius).toBeGreaterThanOrEqual(24);
    expect(pill.border).toBe('0px');
    expect(pill.height).toBeGreaterThanOrEqual(44);
  }
  // The main action is not the same colour as the quiet one, and no list bullets are drawn.
  expect(main.background).not.toBe(quiet.background);
  expect(await dialog(page).locator('ul, li').count()).toBe(0);
});

test('when copying is blocked the link is shown to copy by hand', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true });
  });
  await openRoute(page);
  await page.getByRole('button', { name: 'Share this route' }).click();
  await dialog(page).getByRole('button', { name: 'Copy link' }).click();
  const field = dialog(page).getByRole('textbox', { name: 'Copy this link' });
  await expect(field).toHaveValue(`${new URL(page.url()).origin}/#route/${SLUG}`);
  await expect(dialog(page).getByRole('button', { name: 'Link copied' })).toHaveCount(0);
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
