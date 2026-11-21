import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('a route offers a Get directions button to its start, in maps, in a new tab', async ({ page, request }) => {
  await page.route('**/rest/v1/routes?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#routes');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) await gotIt.click();
  await page.locator('.route-item .result-card', { hasText: 'Southern Ridges' }).click();

  const data = (await (await request.get('/data/routes.json')).json()) as { routes: { slug: string; coordinates: [number, number, number][] }[] };
  const [lng, lat] = data.routes.find((route) => route.slug === 'southern-ridges-walk')!.coordinates[0];

  const link = page.getByRole('link', { name: /Get directions to the start/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noreferrer/);
  await expect(link).toContainText('Get directions');
});
