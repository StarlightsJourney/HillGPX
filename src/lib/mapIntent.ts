import type { Bounds } from './venues';

/**
 * What a search, or "near me", on a page without the map (landing, venue,
 * info) asks the map to do once it opens. The map decides between Routes and
 * Climbs only when it has the data to look, so the request travels as an
 * intent rather than a finished camera move.
 */
export type MapIntent = { kind: 'area'; bounds: Bounds } | { kind: 'place'; slug: string } | { kind: 'near-me' };

const KEY = 'hillgpx:mapIntent';

/** A link anyone can share: opens the map on routes around whoever follows it. */
export const NEAR_ME_HASH = '#map/near-me';

export function openMapWith(intent: MapIntent) {
  if (intent.kind === 'near-me') {
    window.location.hash = NEAR_ME_HASH;
    return;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    // Storage blocked: the map still opens, just without the search.
  }
  window.location.hash = '#map';
}

/** The pending intent, if any, cleared as it is read so it runs once. */
export function takeMapIntent(): MapIntent | null {
  if (window.location.hash === NEAR_ME_HASH) {
    history.replaceState(null, '', '#map');
    return { kind: 'near-me' };
  }
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as MapIntent;
    return intent.kind === 'area' || intent.kind === 'place' ? intent : null;
  } catch {
    return null;
  }
}
