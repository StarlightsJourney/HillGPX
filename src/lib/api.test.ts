import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorMessage, combinedRating, deleteRouteReview, editRouteReview, fetchReviews, fetchRouteReviews, isSchemaError, myRouteReview, publishRoute, submitReview, submitRouteReview, type PublishRouteInput } from './api';
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

describe('route reviews', () => {
  const row = { id: 'r1', route_slug: 'southern-ridges-walk', rating: 4, comment: 'Shady', author: null, created_at: '2026-10-01T00:00:00Z', edited_at: null };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const stubFetch = (response: () => Response) => {
    const mock = vi.fn(async () => response());
    vi.stubGlobal('fetch', mock);
    return () => mock.mock.calls[0] as unknown as [string, RequestInit];
  };

  it('reads approved reviews newest first, naming only the public columns', async () => {
    const call = stubFetch(() => json([row, { ...row, id: 'r2', author: 'ridge_runner', edited_at: '2026-10-02T00:00:00Z' }]));
    const reviews = await fetchRouteReviews('southern-ridges-walk');
    expect(reviews[0]).toEqual({ id: 'r1', routeSlug: 'southern-ridges-walk', rating: 4, comment: 'Shady', author: 'Anonymous', createdAt: '2026-10-01T00:00:00Z', editedAt: null });
    expect(reviews[1]).toMatchObject({ author: 'ridge_runner', editedAt: '2026-10-02T00:00:00Z' });
    const url = call()[0];
    expect(url).toContain('/rest/v1/route_reviews?route_slug=eq.southern-ridges-walk');
    expect(url).toContain('order=created_at.desc');
    expect(url).toContain('limit=200');
    expect(url).not.toContain('user_id');
    expect(url).not.toContain('*');
  });

  it('posts only insertable columns, trimmed, with anonymous as a null credit', async () => {
    const call = stubFetch(() => new Response(null, { status: 201 }));
    const review = await submitRouteReview({ routeSlug: 'southern-ridges-walk', rating: 5, comment: '  Overgrown after km 3  ', author: '' });
    expect(review).toMatchObject({ comment: 'Overgrown after km 3', author: 'Anonymous', editedAt: null, rating: 5 });
    const [url, init] = call();
    expect(url).toContain('/rest/v1/route_reviews');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['author', 'comment', 'id', 'rating', 'route_slug']);
    expect(body.author).toBeNull();
    expect(body.comment).toBe('Overgrown after km 3');
  });

  it('keeps the username as the credit', async () => {
    const call = stubFetch(() => new Response(null, { status: 201 }));
    const review = await submitRouteReview({ routeSlug: 'x-route', rating: 3, comment: 'Fine', author: 'ridge_runner' });
    expect(review.author).toBe('ridge_runner');
    expect((JSON.parse(String(call()[1].body)) as { author: string }).author).toBe('ridge_runner');
  });

  it('passes the link and rate limit refusals through unchanged', async () => {
    for (const message of ['Please leave out web links. Describe it in words instead.', 'You have added a lot in a short time. Please wait a while and try again.']) {
      stubFetch(() => json({ code: 'P0001', message }, 400));
      await expect(submitRouteReview({ routeSlug: 'x-route', rating: 3, comment: 'x', author: '' })).rejects.toThrow(message);
      stubFetch(() => json({ code: 'P0001', message }, 400));
      await expect(editRouteReview('r1', { rating: 3, comment: 'x', author: '' })).rejects.toThrow(message);
    }
  });

  it('says a second review is refused in plain words', async () => {
    stubFetch(() => json({ code: '23505', message: 'duplicate key value violates unique constraint "route_reviews_one_per_user"' }, 409));
    await expect(submitRouteReview({ routeSlug: 'x-route', rating: 3, comment: 'x', author: '' })).rejects.toThrow('You have already reviewed this route.');
  });

  it('leaves other duplicates generic', () => {
    expect(apiErrorMessage('{"code":"23505","message":"duplicate key value violates unique constraint \\"routes_slug_key\\""}', 409)).toBe('Something went wrong (HTTP 409).');
  });

  it('shows a deploy ahead of the migration as not available yet', async () => {
    const calls = [
      () => fetchRouteReviews('x-route'),
      () => submitRouteReview({ routeSlug: 'x-route', rating: 3, comment: 'x', author: '' }),
      () => editRouteReview('r1', { rating: 3, comment: 'x', author: '' }),
      () => myRouteReview('x-route'),
      () => deleteRouteReview('r1'),
    ];
    for (const call of calls) {
      stubFetch(() => json({ code: 'PGRST205', message: "Could not find the table 'public.route_reviews'" }, 404));
      await expect(call()).rejects.toThrow(/not available yet/);
      stubFetch(() => json({ code: '42P01', message: 'relation does not exist' }, 404));
      await expect(call()).rejects.toThrow(/not available yet/);
    }
  });

  it('shows a missing RPC as not available yet', async () => {
    for (const code of ['PGRST202', '42883']) {
      stubFetch(() => json({ code, message: 'Could not find the function' }, 404));
      await expect(myRouteReview('x-route')).rejects.toThrow(/not available yet/);
    }
  });

  it('shows an unreachable database as the ordinary failure, not as a feature still to come', async () => {
    for (const code of ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003']) {
      stubFetch(() => json({ code, message: 'Database connection error' }, 503));
      await expect(fetchRouteReviews('x-route')).rejects.toThrow('Something went wrong (HTTP 503).');
    }
  });

  it('does not call a refused permission a missing table', async () => {
    stubFetch(() => json({ code: '42501', message: 'permission denied for table route_reviews' }, 401));
    await expect(submitRouteReview({ routeSlug: 'x-route', rating: 3, comment: 'x', author: '' })).rejects.toThrow('Something went wrong (HTTP 401).');
  });

  it('edits through the owner RPC and returns the stored credit', async () => {
    const call = stubFetch(() => json([{ ...row, author: 'ridge_runner', comment: 'Cleared now', status: 'approved', edited_at: '2026-10-05T00:00:00Z' }]));
    const review = await editRouteReview('r1', { rating: 2, comment: ' Cleared now ', author: 'ridge_runner' });
    expect(review).toMatchObject({ comment: 'Cleared now', author: 'ridge_runner', editedAt: '2026-10-05T00:00:00Z' });
    const [url, init] = call();
    expect(url).toContain('/rest/v1/rpc/edit_route_review');
    expect(JSON.parse(String(init.body))).toEqual({ p_id: 'r1', p_rating: 2, p_comment: 'Cleared now', p_author: 'ridge_runner' });
  });

  it('sends an anonymous edit as a null credit', async () => {
    const call = stubFetch(() => json([{ ...row, status: 'approved' }]));
    const review = await editRouteReview('r1', { rating: 2, comment: 'x', author: '' });
    expect(review.author).toBe('Anonymous');
    expect((JSON.parse(String(call()[1].body)) as { p_author: unknown }).p_author).toBeNull();
  });

  it('finds my review and whether a moderator hid it', async () => {
    stubFetch(() => json([{ ...row, status: 'approved' }]));
    expect(await myRouteReview('southern-ridges-walk')).toMatchObject({ id: 'r1', hidden: false });
    for (const status of ['pending', 'rejected']) {
      stubFetch(() => json([{ ...row, status }]));
      expect(await myRouteReview('southern-ridges-walk')).toMatchObject({ id: 'r1', hidden: true });
    }
    stubFetch(() => json([]));
    expect(await myRouteReview('southern-ridges-walk')).toBeNull();
  });

  it('deletes through the owner RPC', async () => {
    const call = stubFetch(() => new Response(null, { status: 204 }));
    await deleteRouteReview('r1');
    expect(call()[0]).toContain('/rest/v1/rpc/delete_route_review');
    expect(JSON.parse(String(call()[1].body))).toEqual({ p_id: 'r1' });
  });

  it('averages route reviews with the shared helper', () => {
    expect(combinedRating(undefined, [{ rating: 5 }, { rating: 4 }])).toEqual({ average: 4.5, count: 2 });
  });
});
