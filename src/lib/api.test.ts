import { describe, expect, it, beforeEach } from 'vitest';
import {
  combinedRating,
  loadAuthor,
  loadLocalReviews,
  reviewsForVenue,
  saveAuthor,
  submitReview,
} from './api';

describe('api', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(reviewsForVenue('any')).toEqual([]);
    expect(combinedRating('any', { average: 0, count: 0 })).toBeUndefined();
  });

  it('stores and retrieves a review', async () => {
    const result = await submitReview({
      venueSlug: 'test-hill',
      rating: 4,
      comment: 'Solid climb',
      author: 'Runner',
    });
    expect(result.status).toBe('local');
    expect(result.item.rating).toBe(4);
    const reviews = reviewsForVenue('test-hill');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].comment).toBe('Solid climb');
  });

  it('combines published and local ratings', async () => {
    await submitReview({ venueSlug: 'x', rating: 5, comment: '', author: '' });
    const rating = combinedRating('x', { average: 3, count: 1 });
    expect(rating).toEqual({ average: 4, count: 2 });
  });

  it('persists author name', () => {
    saveAuthor('Alex');
    expect(loadAuthor()).toBe('Alex');
  });

  it('does not leak localStorage between venues', async () => {
    await submitReview({ venueSlug: 'a', rating: 2, comment: '', author: '' });
    expect(reviewsForVenue('b')).toEqual([]);
    expect(loadLocalReviews()).toHaveLength(1);
  });
});
