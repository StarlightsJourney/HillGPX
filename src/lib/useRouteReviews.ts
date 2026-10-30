import { useCallback, useEffect, useMemo, useState } from 'react';
import { combinedRating, errorText, fetchRouteReviews, myRouteReview, type MyRouteReview, type RouteReview } from './api';

export interface RouteReviewsState {
  /** The public list; null while loading or after a failed load. */
  reviews: RouteReview[] | null;
  /** The sentence for a failed load. */
  error: string | null;
  /** The signed-in visitor's own review, hidden or not. */
  mine: MyRouteReview | null;
  /** False until we know whether the visitor already has a review, so the form never flashes. */
  mineKnown: boolean;
  rating: { average: number; count: number } | undefined;
  retry: () => void;
  /** After a post or an edit: the list and "mine" follow without another request. */
  onSaved: (review: RouteReview) => void;
  onDeleted: (id: string) => void;
}

/**
 * One route's reviews and the visitor's own, loaded once each time a route
 * opens: the compact panel needs the average, so this runs even when the
 * reviews section is folded away. Pass `enabled: false` for routes that take
 * no reviews (held, rejected, on this device); nothing is requested.
 */
export function useRouteReviews(routeSlug: string, enabled: boolean, userId: string | null): RouteReviewsState {
  const [reviewList, setReviewList] = useState<{ slug: string; reviews: RouteReview[] | null; error: string | null } | null>(null);
  const [ownReview, setOwnReview] = useState<{ key: string; review: MyRouteReview | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ownKey = `${routeSlug}:${userId}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchRouteReviews(routeSlug)
      .then((reviews) => {
        if (!cancelled) setReviewList({ slug: routeSlug, reviews, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setReviewList({ slug: routeSlug, reviews: null, error: errorText(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [routeSlug, enabled, attempt]);

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    myRouteReview(routeSlug)
      // A failed lookup falls back to the form; the unique index refuses a second post.
      .catch(() => null)
      .then((review) => {
        if (!cancelled) setOwnReview({ key: ownKey, review });
      });
    return () => {
      cancelled = true;
    };
  }, [routeSlug, enabled, userId, ownKey, attempt]);

  const listForRoute = reviewList?.slug === routeSlug ? reviewList : null;
  const reviews = listForRoute?.reviews ?? null;
  const ownForRoute = userId && ownReview?.key === ownKey ? ownReview : null;

  const onSaved = useCallback((review: RouteReview) => {
    setReviewList((state) => state && state.reviews
      ? { ...state, reviews: state.reviews.some((r) => r.id === review.id) ? state.reviews.map((r) => (r.id === review.id ? review : r)) : [review, ...state.reviews] }
      : state);
    setOwnReview((state) => state && { ...state, review: { ...review, hidden: false } });
  }, []);

  const onDeleted = useCallback((id: string) => {
    setReviewList((state) => state && state.reviews ? { ...state, reviews: state.reviews.filter((r) => r.id !== id) } : state);
    setOwnReview((state) => state && { ...state, review: null });
  }, []);

  const retry = useCallback(() => {
    setReviewList(null);
    setAttempt((value) => value + 1);
  }, []);

  const rating = useMemo(() => (reviews ? combinedRating(undefined, reviews) : undefined), [reviews]);

  return { reviews, error: listForRoute?.error ?? null, mine: ownForRoute?.review ?? null, mineKnown: Boolean(ownForRoute), rating, retry, onSaved, onDeleted };
}
