/**
 * Words for a route match (lib/routeMatch.ts): the reasons line on a ranked
 * card and what is off about a weak match, in the visitor's units.
 */
import type { MatchLabel, MatchMiss, MatchReason, Terrain } from './routeMatch';
import { M_TO_FT, formatDistanceIn, type Units } from './units';

/** m/km to ft/mi: 3.28 ft per m over 0.621 mi per km. */
const M_PER_KM_TO_FT_PER_MI = M_TO_FT * 1.609344;

export const MATCH_LABEL_TEXT: Record<MatchLabel, string> = {
  great: 'Great match',
  good: 'Good match',
  partial: 'Partial match',
};

export const TERRAIN_TEXT: Record<Terrain, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  any: 'Any terrain',
};

/** "about 50 min", "about 1 h 25 min": to the nearest 5 minutes, never zero. */
export function formatDuration(seconds: number): string {
  return `about ${minutesText(Math.max(5, Math.round(seconds / 300) * 5))}`;
}

/** "40 min", "1 h", "6 h 45 min". */
function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
}

function formatClimbRate(mPerKm: number, units: Units): string {
  return units === 'imperial' ? `${Math.round(mPerKm * M_PER_KM_TO_FT_PER_MI)} ft/mi` : `${Math.round(mPerKm)} m/km`;
}

export function describeReason(reason: MatchReason, units: Units): string {
  switch (reason.kind) {
    case 'away':
      return reason.metres === 0 ? 'In this area' : `${formatDistanceIn(reason.metres, units)} away`;
    case 'length':
      return `${formatDistanceIn(reason.metres, units)}, ${formatDuration(reason.durationS)}`;
    case 'terrain':
      return reason.band == null || reason.climbRateMPerKm == null
        ? 'elevation unknown'
        : `${TERRAIN_TEXT[reason.band]} (${formatClimbRate(reason.climbRateMPerKm, units)})`;
  }
}

/** One line: "2.0 km away · 8.4 km, about 50 min · Rolling (18 m/km)". */
export function describeReasons(reasons: MatchReason[], units: Units): string {
  return reasons.map((reason) => describeReason(reason, units)).join(' · ');
}

/** "4.0 km longer than you asked", "Hilly, not flat". */
export function describeMiss(miss: MatchMiss, units: Units): string {
  if (miss.kind === 'terrain') return `${TERRAIN_TEXT[miss.band]}, not ${TERRAIN_TEXT[miss.wanted].toLowerCase()}`;
  const amount = miss.unit === 'time' ? minutesText(Math.max(1, Math.round(miss.by / 60))) : formatDistanceIn(miss.by, units);
  return `${amount} ${miss.longer ? 'longer' : 'shorter'} than you asked`;
}
