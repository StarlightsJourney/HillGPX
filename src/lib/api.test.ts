import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorMessage, combinedRating, fetchReviews, isSchemaError, publishRoute, submitReview, type PublishRouteInput } from './api';
import type { QualityFlag } from './routeQuality';
import { routeFromPoints } from './routes';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('combines published and community ratings', () => {
    const reviews = [{ id: '1', venueSlug: 'x', rating: 5, comment: '', author: 'A', createdAt: '' }];
    expect(combinedRating({ average: 3, count: 1 }, reviews)).toEqual({ average: 4, count: 2 });
    expect(combinedRating(undefined, [])).toBeUndefined();
  });

  it('posts a review with only insertable columns', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const review = await submitReview({ venueSlug: 'test-hill', rating: 4, comment: ' Solid ', author: '' });
    expect(review.comment).toBe('Solid');
    expect(review.author).toBe('Anonymous');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/rest/v1/reviews');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('status');
    expect(body.venue_slug).toBe('test-hill');
  });

  it('shows the spam limit message, not the raw response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'P0001', message: 'You have already reviewed this place today.' }), { status: 400 })));
    await expect(submitReview({ venueSlug: 'test-hill', rating: 4, comment: '', author: '' })).rejects.toThrow('You have already reviewed this place today.');
  });

  it('explains a storage refusal as the upload ceiling', () => {
    expect(apiErrorMessage('{"message":"new row violates row-level security policy"}', 403)).toMatch(/Uploads are paused/);
  });

  it('genericizes engine noise but keeps its errcode for fallbacks', () => {
    expect(apiErrorMessage('{"code":"42703","message":"column routes.anonymous does not exist"}', 400)).toBe('Something went wrong (HTTP 400).');
    expect(isSchemaError(new ApiError('x', 400, '42703'))).toBe(true);
    expect(isSchemaError(new ApiError('x', 400, 'PGRST202'))).toBe(true);
    expect(isSchemaError(new ApiError('x', 400, 'P0001'))).toBe(false);
    expect(isSchemaError(new ApiError('x', 409, '23505'))).toBe(false);
  });

  it('maps review rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 'a', venue_slug: 'v', rating: 5, comment: 'Great', author: null, created_at: '2026-01-01T00:00:00Z' },
    ]), { status: 200 })));
    const [review] = await fetchReviews('v');
    expect(review).toMatchObject({ venueSlug: 'v', rating: 5, author: 'Anonymous' });
  });
});

describe('publishing with quality flags', () => {
  const key: QualityFlag = { id: 'too-short', severity: 'key', value: 5, threshold: 10, unit: 'points' };
  const note: QualityFlag = { id: 'no-elevation', severity: 'advisory', value: 0, threshold: 1, unit: 'm' };
  const input = (qualityFlags: QualityFlag[]): PublishRouteInput => ({
    route: routeFromPoints('Ridge Loop', Array.from({ length: 12 }, (_, i): [number, number, number] => [103.8 + i * 0.001, 1.3, 10]), []),
    activity: 'run',
    fingerprint: 'abcdef123456',
    recordedAt: null,
    elevationSource: 'gps',
    originalGpx: null,
    contributor: '',
    licence: 'CC BY 4.0',
    qualityFlags,
  });

  it('sends the flags and never a status, and reports a key flag as held', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/rest/v1/routes')) bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 201 });
    }));
    const stored = await publishRoute(input([key]));
    const body = bodies[0];
    expect(body.quality_flags).toEqual([key]);
    expect(body).not.toHaveProperty('status');
    expect(stored.held).toBe(true);
  });

  it('publishes a route with only advisory notes as public', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));
    expect((await publishRoute(input([note]))).held).toBeUndefined();
  });

  it('refuses to publish a held route when the database cannot record the flags yet', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/rest/v1/routes')
        ? new Response(JSON.stringify({ code: '42703', message: 'column quality_flags does not exist' }), { status: 400 })
        : new Response(null, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(publishRoute(input([key]))).rejects.toMatchObject({ status: 503 });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/rest/v1/routes'))).toHaveLength(1);
  });

  it('falls back to a plain insert for a clean route on an older database', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      if (!String(url).includes('/rest/v1/routes')) return new Response(null, { status: 201 });
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ code: '42703', message: 'column quality_flags does not exist' }), { status: 400 })
        : new Response(null, { status: 201 });
    }));
    await expect(publishRoute(input([]))).resolves.toMatchObject({ slug: expect.any(String) });
    expect(attempts).toBe(2);
  });
});
