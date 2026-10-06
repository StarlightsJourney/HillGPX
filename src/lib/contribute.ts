/**
 * Contribution links.
 *
 * There is no server, so a rating, a photo or a new place is published the same
 * way a height fix is: as a reviewable change to the repository. These build
 * links to the GitHub issue forms in .github/ISSUE_TEMPLATE, prefilled with
 * whatever the page already knows, so contributing is one click and one submit.
 */

export const REPO_URL = 'https://github.com/StarlightsJourney/HillGPX';

/** Questions and removal requests: a public GitHub form (see .github/ISSUE_TEMPLATE/contact.yml). */
export const CONTACT_URL = `${REPO_URL}/issues/new?template=contact.yml`;
/**
 * A private address for removal requests, shown on the Contact page when set.
 * Left empty until the maintainer chooses one to publish.
 */
export const CONTACT_EMAIL = '';

/** Opens the report form for something drawn outside React (map popups); App listens. */
export const REPORT_EVENT = 'hillgpx:report';
export interface ReportRequest {
  targetType: 'photo' | 'route_photo' | 'review';
  targetSlug: string;
  targetName: string;
}
export function requestReport(detail: ReportRequest): void {
  window.dispatchEvent(new CustomEvent<ReportRequest>(REPORT_EVENT, { detail }));
}

/** Asks the map page (which also hosts venue pages) to open the "Add a GPX" dialog where you are. */
export const IMPORT_EVENT = 'hillgpx:import';

/**
 * Click handler for every "Add a GPX" link. On a venue page, following
 * `#import` left the page for the map; the dialog opens over the venue page
 * instead. Elsewhere the link is followed as usual.
 */
export function openImportHere(event: { preventDefault: () => void }): void {
  if (!window.location.hash.startsWith('#venue/')) return;
  event.preventDefault();
  window.dispatchEvent(new Event(IMPORT_EVENT));
}

function issueUrl(template: string, fields: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams({ template });
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

export const rateVenueUrl = (venue: string, rating?: number, name?: string) =>
  issueUrl('rate-venue.yml', { venue, rating, title: name ? `Rating: ${name}` : undefined });

export const addPhotoUrl = (venue: string, name?: string) =>
  issueUrl('add-photo.yml', { venue, title: name ? `Photo: ${name}` : undefined });

export const addPlaceUrl = (lat?: number, lng?: number) =>
  issueUrl('add-place.yml', { lat: lat?.toFixed(5), lng: lng?.toFixed(5) });

export const addRouteUrl = (name?: string) => issueUrl('add-route.yml', { name });

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
    // Storage full or disabled: the GitHub link still works without it.
  }
}
