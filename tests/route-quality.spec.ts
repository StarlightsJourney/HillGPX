import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/**
 * Route quality checks end to end against a stubbed Supabase: a track that
 * teleports is held (signed in) or blocked (guest), a clean track publishes.
 * Fixtures go to the temp folder, never the repo.
 */
const DIR = '/tmp/hillgpx-quality';
mkdirSync(DIR, { recursive: true });

const REF = 'dzpgnebkyubeptitzjlj';
const USER_ID = '22222222-2222-4222-8222-222222222222';

/** 120 fixes, 5 s apart, heading east near Pasir Ris; `jumpAt` shifts everything after it ~55 km. */
function gpx(name: string, jumpAt: number | null): string {
  const points = Array.from({ length: 120 }, (_, i) => {
    const lng = 103.95 + i * 0.00012 + (jumpAt !== null && i >= jumpAt ? 0.5 : 0);
    const time = new Date(Date.UTC(2026, 9, 1, 6, 0, i * 5)).toISOString();
    return `<trkpt lat="${(1.37 + Math.sin(i / 9) * 0.0004).toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${(8 + Math.sin(i / 14) * 3).toFixed(1)}</ele><time>${time}</time></trkpt>`;
  });
  return `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${points.join('')}</trkseg></trk></gpx>`;
}
const BAD = `${DIR}/teleport.gpx`;
const GOOD = `${DIR}/clean.gpx`;
writeFileSync(BAD, gpx('Pasir Ris Teleport', 60));
writeFileSync(GOOD, gpx('Pasir Ris Shore Run', null));

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

interface PostedRoute {
  quality_flags: { id: string; severity: string }[];
  status?: string;
}

async function stub(page: Page, { signedIn }: { signedIn: boolean }): Promise<PostedRoute[]> {
  const posted: PostedRoute[] = [];
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
    if (url.pathname.endsWith('/rest/v1/routes') && method === 'POST') {
      posted.push(JSON.parse(route.request().postData() ?? '{}') as PostedRoute);
      return route.fulfill({ status: 201, body: '' });
    }
    if (url.pathname.includes('/storage/v1/')) return route.fulfill({ json: { Key: 'stub' } });
    if (url.pathname.endsWith('/rest/v1/profiles')) return route.fulfill({ json: [{ id: USER_ID, username: 'ridge_runner', avatar_path: null }] });
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: session().user });
    if (url.pathname.includes('/rpc/route_downloads')) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return posted;
}

async function upload(page: Page, file: string) {
  await page.goto('/#import');
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.locator('.gpx-panel')).toBeVisible({ timeout: 30_000 });
}

test.use({ viewport: { width: 1280, height: 900 } });

test('a guest cannot publish a track that jumps, and is told why', async ({ page }) => {
  const posted = await stub(page, { signedIn: false });
  await upload(page, BAD);
  await expect(page.locator('.quality-notice.held')).toContainText('cannot be published yet');
  await expect(page.locator('.quality-notice.held')).toContainText('jumps');
  const button = page.getByRole('button', { name: 'Fix the track to publish' });
  await expect(button).toBeDisabled();
  expect(posted).toEqual([]);
});

test('a signed-in uploader saves the same track privately, with the reasons', async ({ page }) => {
  const posted = await stub(page, { signedIn: true });
  await upload(page, BAD);
  await expect(page.locator('.quality-notice.held')).toContainText('only you can see it');
  await page.getByRole('button', { name: 'Save privately' }).click();
  await expect(page.locator('.gpx-published')).toContainText('Only you can see it');
  await expect(page.getByText('Why it is held')).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0].quality_flags.map((f) => [f.id, f.severity])).toContainEqual(['gps-jump', 'key']);
  expect(posted[0]).not.toHaveProperty('status');
});

test('a clean track publishes as before for a guest', async ({ page }) => {
  const posted = await stub(page, { signedIn: false });
  await upload(page, GOOD);
  await expect(page.locator('.quality-notice')).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish route' }).click();
  await expect(page.locator('.gpx-published')).toContainText('Published to the community archive');
  expect(posted).toHaveLength(1);
  expect(posted[0].quality_flags.filter((f) => f.severity === 'key')).toEqual([]);
});
