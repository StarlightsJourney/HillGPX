/**
 * Contribution plumbing.
 *
 * Ratings, photos, routes, reports, contact messages and place suggestions
 * all go into the shared store through api.ts; this module holds the events
 * that open those forms from anywhere and the bits of browser state they use.
 */
import type { ReportTarget } from './api';

/**
 * A private address for removal requests, shown on the Contact page when set.
 * Left empty until the maintainer chooses one to publish.
 */
export const CONTACT_EMAIL = '';

/** Opens the "Add a missing place" dialog from anywhere (the footer on every page); App listens. */
export const ADD_PLACE_EVENT = 'hillgpx:add-place';
export function requestAddPlace(): void {
  window.dispatchEvent(new Event(ADD_PLACE_EVENT));
}

/** Opens the report form for something drawn outside React (map popups); App listens. */
export const REPORT_EVENT = 'hillgpx:report';
export interface ReportRequest {
  targetType: Exclude<ReportTarget, 'venue' | 'route'>;
  targetSlug: string;
  targetName: string;
}
export function requestReport(detail: ReportRequest): void {
  window.dispatchEvent(new CustomEvent<ReportRequest>(REPORT_EVENT, { detail }));
}

export function requestReviewReport(targetType: 'review' | 'route_review', review: { id: string; author: string }): void {
  requestReport({ targetType, targetSlug: review.id, targetName: `${review.author}'s review` });
}

/** Asks the map page (which also hosts venue pages) to open the "Upload GPX" dialog where you are. */
export const IMPORT_EVENT = 'hillgpx:import';

/**
 * Click handler for every "Upload GPX" link. On a venue page, following
 * `#import` left the page for the map; the dialog opens over the venue page
 * instead. Elsewhere the link is followed as usual.
 */
export function openImportHere(event: { preventDefault: () => void }): void {
  if (!window.location.hash.startsWith('#venue/')) return;
  event.preventDefault();
  window.dispatchEvent(new Event(IMPORT_EVENT));
}

const RATINGS_KEY = 'hillgpx:myRatings';

/** Your own ratings, kept in this browser until they are published. */
export function loadMyRatings(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveMyRating(slug: string, rating: number): void {
  const next = { ...loadMyRatings(), [slug]: rating };
  try {
    localStorage.setItem(RATINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or disabled: the rating just is not remembered.
  }
}
