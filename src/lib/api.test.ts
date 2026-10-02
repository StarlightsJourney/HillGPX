import { afterEach, describe, expect, it, vi } from 'vitest';
import { combinedRating, fetchReviews, loadAuthor, saveAuthor, submitReview } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('combines published and community ratings', () => {
    const reviews = [{ id: '1', venueSlug: 'x', rating: 5, comment: '', author: 'A', createdAt: '' }];
    expect(combinedRating({ average: 3, count: 1 }, reviews)).toEqual({ average: 4, count: 2 });
    expect(combinedRating(undefined, [])).toBeUndefined();
  });

  it('persists author name', () => {
    saveAuthor('Alex');
    expect(loadAuthor()).toBe('Alex');
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

  it('maps review rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 'a', venue_slug: 'v', rating: 5, comment: 'Great', author: null, created_at: '2026-01-01T00:00:00Z' },
    ]), { status: 200 })));
    const [review] = await fetchReviews('v');
    expect(review).toMatchObject({ venueSlug: 'v', rating: 5, author: 'Anonymous' });
  });
});
