import { test, expect, type Page } from '@playwright/test';

/**
 * Route reviews in the open route panel, against a stubbed Supabase: a real
 * committed route, a fake session in storage and REST answers that keep state,
 * so posting, editing and deleting show what the server would hand back.
 */
const REF = 'dzpgnebkyubeptitzjlj';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ROUTE = 'Hong Kong Trail Section 2';

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
      id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'ridge@example.com', created_at: '2026-03-02T00:00:00Z',
      app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { username: 'ridge_runner' }, identities: [{ provider: 'google' }],
    },
  };
}

interface Row {
  id: string;
  route_slug: string;
  rating: number;
  comment: string;
  author: string | null;
  created_at: string;
  edited_at: string | null;
  status?: string;
}

const row = (id: string, rating: number, comment: string, author: string | null, day: number): Row => ({
  id, route_slug: 'hong-kong-trail-section-2', rating, comment, author, created_at: `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`, edited_at: null,
});

interface Setup {
  signedIn?: boolean;
  reviews?: Row[];
  mine?: Row | null;
  failRead?: boolean;
}

/** The fake server. Returns what it was sent, to check the client's requests. */
async function stub(page: Page, { signedIn = false, reviews = [], mine = null, failRead = false }: Setup) {
  const state = { reviews: [...reviews], mine, posted: [] as Record<string, unknown>[], reports: [] as Record<string, unknown>[] };
  await page.addInitScript(
    ([key, value, signed]) => {
      sessionStorage.setItem('hillgpx:openSourceNoticeSeen', '1');
      if (signed) localStorage.setItem(key, value);
    },
    [`sb-${REF}-auth-token`, JSON.stringify(session()), signedIn] as const,
  );
  await page.route(`https://${REF}.supabase.co/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = () => JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    if (url.pathname.endsWith('/rest/v1/route_reviews')) {
      if (method === 'POST') {
        const sent = body();
        state.posted.push(sent);
        const stored = { ...(sent as unknown as Row), created_at: new Date().toISOString(), edited_at: null };
        state.reviews.unshift(stored);
        state.mine = stored;
        return route.fulfill({ status: 201, body: '' });
      }
      if (failRead) return route.fulfill({ status: 500, json: { message: 'boom' } });
      return route.fulfill({ json: state.reviews.filter((review) => !review.status || review.status === 'approved') });
    }
    if (url.pathname.endsWith('/rpc/my_route_review')) return route.fulfill({ json: state.mine ? [{ status: 'approved', ...state.mine }] : [] });
    if (url.pathname.endsWith('/rpc/edit_route_review')) {
      const sent = body();
      const edited = { ...state.mine!, rating: Number(sent.p_rating), comment: String(sent.p_comment), author: (sent.p_author as string | null), edited_at: new Date().toISOString() };
      state.mine = edited;
      state.reviews = state.reviews.map((review) => (review.id === edited.id ? edited : review));
      return route.fulfill({ json: [{ status: 'approved', ...edited }] });
    }
    if (url.pathname.endsWith('/rpc/delete_route_review')) {
      state.reviews = state.reviews.filter((review) => review.id !== state.mine?.id);
      state.mine = null;
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname.endsWith('/rest/v1/reports')) {
      state.reports.push(body());
      return route.fulfill({ status: 201, body: '' });
    }
    if (url.pathname.endsWith('/rest/v1/profiles')) return route.fulfill({ json: [{ id: USER_ID, username: 'ridge_runner', avatar_path: null }] });
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: session().user });
    if (url.pathname.includes('/rpc/route_downloads')) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return state;
}

async function openRoute(page: Page) {
  await page.goto('/#routes');
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Search countries, hills, routes, blocks and streets').fill('hong kong');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('.route-item .result-card', { hasText: ROUTE }).click();
  await expect(panel(page)).toBeVisible();
}

const panel = (page: Page) => page.getByRole('region', { name: `Route: ${ROUTE}` });

async function moreDetails(page: Page) {
  await panel(page).getByRole('button', { name: 'Show more route details' }).click();
  await expect(panel(page)).toHaveClass(/expanded/);
}

test.use({ viewport: { width: 1280, height: 900 } });

test('a guest reads reviews and the rating, and is asked to log in rather than shown a form', async ({ page }) => {
  await stub(page, { reviews: [row('a', 5, 'Good shade all the way', 'hill_goat', 20), row('b', 4, 'Muddy after rain', null, 12)] });
  await openRoute(page);
  // Compact view: the average and the count, before "More details".
  await expect(panel(page).getByLabel('Rated 4.5 out of 5, 2 reviews')).toBeVisible();
  await moreDetails(page);
  const section = panel(page).locator('.route-reviews');
  const cards = section.locator('.review-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('hill_goat');
  await expect(cards.first()).toContainText('Good shade all the way');
  await expect(cards.nth(1)).toContainText('Anonymous');
  await expect(section.getByRole('textbox')).toHaveCount(0);

  await section.getByRole('button', { name: 'Log in to write a review' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel(page)).toBeVisible();
});

test('a route with no reviews reads New, with a plain empty state', async ({ page }) => {
  await stub(page, {});
  await openRoute(page);
  await expect(panel(page).getByLabel('New, no reviews yet')).toBeVisible();
  await moreDetails(page);
  await expect(panel(page).locator('.route-reviews')).toContainText('No reviews yet');
  await expect(panel(page).locator('.review-card')).toHaveCount(0);
});

test('a failed load says so and does not pass for no reviews', async ({ page }) => {
  await stub(page, { failRead: true });
  await openRoute(page);
  await expect(panel(page).getByLabel('New, no reviews yet')).toHaveCount(0);
  await moreDetails(page);
  const section = panel(page).locator('.route-reviews');
  await expect(section.getByRole('alert')).toContainText('Could not load reviews');
  await expect(section).not.toContainText('No reviews yet');
  await expect(section.getByRole('textbox')).toHaveCount(0);
});

test('posting needs stars and a comment; the review then shows at the top as yours', async ({ page }) => {
  const state = await stub(page, { signedIn: true, reviews: [row('a', 2, 'Older note', 'hill_goat', 20)] });
  await openRoute(page);
  await moreDetails(page);
  const section = panel(page).locator('.route-reviews');
  const post = section.getByRole('button', { name: 'Post review' });
  await expect(post).toBeDisabled();

  const box = section.getByRole('textbox');
  await box.fill('   ');
  await section.getByRole('radio', { name: '4 stars' }).click();
  await expect(post).toBeDisabled();
  await section.getByRole('radio', { name: '4 stars' }).click();
  await box.fill('Overgrown past the second shelter');
  await expect(post).toBeEnabled();
  await expect(box).toHaveAttribute('maxlength', '1000');
  await section.getByRole('radio', { name: 'Anonymous' }).click();
  await post.click();

  const first = section.locator('.review-card').first();
  await expect(first).toContainText('Your review');
  await expect(first).toContainText('Overgrown past the second shelter');
  await expect(first).toContainText('Anonymous');
  await expect(section.getByRole('textbox')).toHaveCount(0);
  await expect(panel(page).getByLabel('Rated 3.0 out of 5, 2 reviews')).toBeVisible();
  expect(state.posted).toHaveLength(1);
  expect(Object.keys(state.posted[0]).sort()).toEqual(['author', 'comment', 'id', 'rating', 'route_slug']);
  expect(state.posted[0].author).toBeNull();
});

test('your review has no form; you can edit it (marked edited) and delete it, then write again', async ({ page }) => {
  const own = row('mine', 3, 'First impressions', 'ridge_runner', 25);
  await stub(page, { signedIn: true, reviews: [own, row('a', 5, 'Lovely', 'hill_goat', 20)], mine: own });
  await openRoute(page);
  await moreDetails(page);
  const section = panel(page).locator('.route-reviews');
  const mine = section.locator('.review-card', { hasText: 'Your review' });
  await expect(mine).toContainText('First impressions');
  await expect(section.getByRole('textbox')).toHaveCount(0);
  await expect(mine.getByRole('button', { name: 'Report' })).toHaveCount(0);

  await mine.getByRole('button', { name: 'Edit' }).click();
  const box = section.getByRole('textbox');
  await expect(box).toHaveValue('First impressions');
  await expect(section.getByRole('radio', { name: '3 stars' })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('radio', { name: 'ridge_runner' })).toHaveAttribute('aria-checked', 'true');
  await box.fill('Second look: the bridge is fixed');
  await section.getByRole('button', { name: 'Save review' }).click();
  await expect(mine).toContainText('Second look: the bridge is fixed');
  await expect(mine).toContainText(/edited/i);

  await mine.getByRole('button', { name: 'Delete' }).click();
  await expect(mine).toContainText('Second look');
  await section.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(section.locator('.review-card', { hasText: 'Your review' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Post review' })).toBeVisible();
});

test('a hidden review shows to its author with no actions and no form', async ({ page }) => {
  const own: Row = { ...row('mine', 1, 'Something rude', 'ridge_runner', 25), status: 'rejected' };
  await stub(page, { signedIn: true, reviews: [own, row('a', 5, 'Lovely', 'hill_goat', 20)], mine: own });
  await openRoute(page);
  // Out of the public read, so out of the average.
  await expect(panel(page).getByLabel('Rated 5.0 out of 5, 1 review')).toBeVisible();
  await moreDetails(page);
  const section = panel(page).locator('.route-reviews');
  const mine = section.locator('.review-card', { hasText: 'Hidden by a moderator' });
  await expect(mine).toContainText('Something rude');
  await expect(mine.getByRole('button')).toHaveCount(0);
  await expect(section.getByRole('textbox')).toHaveCount(0);
});

test('Show all opens every review; the panel keeps the 3 newest', async ({ page }) => {
  const reviews = [1, 2, 3, 4, 5].map((n) => row(`r${n}`, 4, `Review number ${n}`, 'hill_goat', 20 - n));
  await stub(page, { reviews });
  await openRoute(page);
  await moreDetails(page);
  const section = panel(page).locator('.route-reviews');
  await expect(section.locator('.review-card')).toHaveCount(3);
  await section.getByRole('button', { name: 'Show all 5 reviews' }).click();
  await expect(page.getByRole('dialog').locator('.review-card')).toHaveCount(5);
});

test('long reviews are clamped behind Show more', async ({ page }) => {
  await stub(page, { reviews: [row('a', 4, 'Long note about the trail. '.repeat(14), 'hill_goat', 20)] });
  await openRoute(page);
  await moreDetails(page);
  const card = panel(page).locator('.review-card');
  await expect(card.locator('.review-text')).toHaveClass(/clamped/);
  await card.getByRole('button', { name: 'Show more' }).click();
  await expect(card.locator('.review-text')).not.toHaveClass(/clamped/);
});

test('Report opens the report dialog for that one review', async ({ page }) => {
  const state = await stub(page, { reviews: [row('abc', 1, 'Spam text', 'hill_goat', 20)] });
  await openRoute(page);
  await moreDetails(page);
  await panel(page).locator('.review-card').getByRole('button', { name: 'Report' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText("Report hill_goat's review");
  await dialog.getByRole('radio', { name: /Spam, rude or personal/ }).click();
  await dialog.getByRole('textbox').fill('This is an advert');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog).toContainText('Thank you');
  expect(state.reports[0]).toMatchObject({ target_type: 'route_review', target_slug: 'abc', kind: 'abuse' });
});

test('folding the panel hides the rating with the rest', async ({ page }) => {
  await stub(page, { reviews: [row('a', 5, 'Fine', 'hill_goat', 20)] });
  await openRoute(page);
  const rating = panel(page).getByLabel('Rated 5.0 out of 5, 1 review');
  await expect(rating).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.evaluate(() => window.scrollTo(0, 0));
  const canvas = await page.locator('.maplibregl-canvas').boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width - 120, canvas!.y + 200);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + canvas!.width - 200, canvas!.y + 250, { steps: 8 });
  await expect(panel(page)).toHaveClass(/\bfolded\b/);
  await expect(rating).toBeHidden();
  await page.mouse.up();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('reviews can be read and written in the bottom sheet', async ({ page }) => {
    await stub(page, { signedIn: true, reviews: [row('a', 5, 'Good shade all the way', 'hill_goat', 20)] });
    await page.goto('/#routes');
    await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('.route-item .result-card', { hasText: 'Southern Ridges' }).click();
    const sheet = page.locator('.route-panel');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Rated 5.0 out of 5, 1 review')).toBeVisible();
    await sheet.getByRole('button', { name: 'Show more route details' }).click();
    await expect(sheet).toHaveClass(/expanded/);
    const section = sheet.locator('.route-reviews');
    await section.locator('.review-card').first().scrollIntoViewIfNeeded();
    await expect(section.locator('.review-card').first()).toBeInViewport();
    const post = section.getByRole('button', { name: 'Post review' });
    await post.scrollIntoViewIfNeeded();
    await expect(post).toBeInViewport();
    const overflow = await sheet.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: '/tmp/hillgpx-pw-reviews/phone.png' });
  });
});
