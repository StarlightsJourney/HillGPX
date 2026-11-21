import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

// A route nobody has seen: no stored time anywhere, only its points. About 21 km round a Singapore block, gentle.
const fresh = (activity: 'run' | 'trail' | 'cycle') => ({
  slug: `fresh-${activity}`,
  name: `Fresh ${activity}`,
  activity,
  recorded_at: null,
  distance_m: 20_900,
  gain_m: 40,
  loss_m: 40,
  elevation_source: 'gps',
  venue_slugs: [],
  points: [
    [103.855, 1.28, 5],
    [103.902, 1.28, 15],
    [103.902, 1.327, 25],
    [103.855, 1.327, 15],
    [103.855, 1.28, 5],
  ],
  gpx_path: `fresh-${activity}.gpx`,
  contributor: 'Test',
  licence: 'CC-BY-4.0',
  downloads: 0,
  created_at: '2026-11-20T00:00:00Z',
});

test('a newly added route shows an estimated time on its card and its panel, by its own activity', async ({ page }) => {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [fresh('run'), fresh('trail'), fresh('cycle')] }));
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await expect(page.locator('.route-item .result-card', { hasText: 'Fresh run' })).toBeVisible({ timeout: 15_000 });

  const minutesOf = (text: string) => {
    const hours = /(\d+) h/.exec(text);
    const mins = /(\d+) min/.exec(text);
    return Number(hours?.[1] ?? 0) * 60 + Number(mins?.[1] ?? 0);
  };
  const cardTime = async (name: string) => {
    const card = page.locator('.route-item .result-card', { hasText: name });
    return (await card.locator('strong', { hasText: '~' }).first().textContent()) ?? '';
  };
  const run = await cardTime('Fresh run');
  const trail = await cardTime('Fresh trail');
  const ride = await cardTime('Fresh cycle');
  expect(run).toMatch(/^~/);
  // The same ground takes a trail longer than the road, and a ride less time than either.
  expect(minutesOf(trail)).toBeGreaterThan(minutesOf(run));
  expect(minutesOf(ride)).toBeLessThan(minutesOf(run));

  // The panel gives the same figure as the card.
  await page.locator('.route-item .result-card', { hasText: 'Fresh trail' }).click();
  const panelTime = page.locator('.route-panel .gpx-stat', { hasText: 'Est. time' }).first().locator('strong');
  await expect(panelTime).toHaveText(trail);
});
