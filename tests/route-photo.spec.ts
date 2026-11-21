import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

// A spot on the Southern Ridges walk: point 300 of its committed route
// (public/data/routes.json) is (103.807417, 1.279206), where the trail runs
// east-west. The runner's GPS reads ~10 m south of it.
const ON_TRAIL = { latitude: 1.279116, longitude: 103.807417 };
const SNAPPED = { index: 300, lng: 103.807417, lat: 1.279206 };
// A real photo from the same corner of Singapore, uploaded (stubbed) as the hazard.
const PHOTO = path.join(process.cwd(), 'public/photos/blk-48-telok-blangah-drive.webp');

interface PostedPhoto {
  route_slug: string;
  kind: string;
  lng: number;
  lat: number;
  caption: string | null;
}

async function dismissNotice(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
}

/** Stub the community back end: no uploaded routes or photos, and uploads succeed without leaving the machine. */
async function stubBackend(context: BrowserContext): Promise<PostedPhoto[]> {
  const posted: PostedPhoto[] = [];
  await context.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await context.route('**/rest/v1/route_photos**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      posted.push(JSON.parse(request.postData() ?? '{}') as PostedPhoto);
      return route.fulfill({ status: 201, body: '' });
    }
    return route.fulfill({ json: [] });
  });
  await context.route('**/storage/v1/object/photos/**', (route) => route.fulfill({ json: { Key: 'stub' } }));
  return posted;
}

async function openAddDialog(page: Page) {
  await page.goto('/#routes');
  await dismissNotice(page);
  await page.locator('.result-card', { hasText: 'Southern Ridges Walk' }).click();
  await page.getByRole('button', { name: 'Show more route details' }).click();
  await page.getByRole('button', { name: 'Photo or hazard' }).click();
  return page.getByRole('dialog', { name: 'Add to Southern Ridges Walk' });
}

test('a runner on the Southern Ridges pins a hazard where they stand', async ({ browser }) => {
  const context = await browser.newContext({ geolocation: ON_TRAIL, permissions: ['geolocation'] });
  const posted = await stubBackend(context);
  const page = await context.newPage();
  const dialog = await openAddDialog(page);

  await dialog.getByRole('radio', { name: 'Hazard' }).click();
  await dialog.getByRole('button', { name: 'Use my location' }).click();
  await expect(dialog.locator('.route-photo-locate-note')).toContainText('Placed where you are');
  await expect(dialog.getByRole('slider')).toHaveValue(String(SNAPPED.index));

  await dialog.locator('input[type="file"]').first().setInputFiles(PHOTO);
  await dialog.getByLabel('What is the hazard?').fill('Fallen tree across the boardwalk');
  await dialog.getByRole('button', { name: 'Report hazard' }).click();
  await expect(dialog.getByText('Added. It is on the route for everyone now.')).toBeVisible();

  expect(posted).toEqual([
    expect.objectContaining({ route_slug: 'southern-ridges-walk', kind: 'hazard', lng: SNAPPED.lng, lat: SNAPPED.lat, caption: 'Fallen tree across the boardwalk' }),
  ]);
  await context.close();
});

test('a runner 1 km from the route is told so and keeps the slider', async ({ browser }) => {
  // ~1 km south of the snapped point, out over Telok Blangah.
  const context = await browser.newContext({ geolocation: { latitude: ON_TRAIL.latitude - 0.009, longitude: ON_TRAIL.longitude }, permissions: ['geolocation'] });
  await stubBackend(context);
  const page = await context.newPage();
  const dialog = await openAddDialog(page);
  const slider = dialog.getByRole('slider');
  const before = await slider.inputValue();

  await dialog.getByRole('button', { name: 'Use my location' }).click();
  await expect(dialog.locator('.route-photo-locate-note')).toContainText('You don’t seem to be on this route');
  await expect(slider).toHaveValue(before);
  await slider.fill('120');
  await expect(slider).toHaveValue('120');
  await context.close();
});

test('blocked location says so and leaves the slider working', async ({ browser }) => {
  const context = await browser.newContext({ permissions: [] });
  await stubBackend(context);
  const page = await context.newPage();
  const dialog = await openAddDialog(page);

  await dialog.getByRole('button', { name: 'Use my location' }).click();
  await expect(dialog.locator('.route-photo-locate-note')).toContainText('slider');
  const slider = dialog.getByRole('slider');
  await slider.fill('42');
  await expect(slider).toHaveValue('42');
  await context.close();
});

test('on a phone the dialog offers the camera directly', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await stubBackend(context);
  const page = await context.newPage();
  const dialog = await openAddDialog(page);
  await expect(dialog.locator('input[type="file"][capture="environment"]')).toHaveCount(1);
  await expect(dialog.getByText('Take a photo')).toBeVisible();
  await context.close();
});
