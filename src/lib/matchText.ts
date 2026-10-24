/**
 * Words for a route match (lib/routeMatch.ts): the reasons line on a ranked
 * card and what is off about a weak match, in the visitor's units.
 */
import { HALF_MARATHON_M, type MatchLabel, type MatchMiss, type MatchReason, type RunLength, type Terrain } from './routeMatch';
import { METRES_PER_MILE, M_TO_FT, formatDistanceShort, type Units } from './units';

/** m/km to ft/mi: feet per metre times kilometres per mile. */
const M_PER_KM_TO_FT_PER_MI = (M_TO_FT * METRES_PER_MILE) / 1000;

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
      return reason.metres === 0 ? 'In this area' : `${formatDistanceShort(reason.metres, units)} away`;
    case 'length':
      return `${formatDistanceShort(reason.metres, units)}, ${formatDuration(reason.durationS)}`;
    case 'terrain':
      return reason.band == null || reason.climbRateMPerKm == null
        ? 'elevation unknown'
        : `${TERRAIN_TEXT[reason.band]} (${formatClimbRate(reason.climbRateMPerKm, units)})`;
  }
}

/** One line: "2 km away · 8.4 km, about 50 min · Rolling (18 m/km)". */
export function describeReasons(reasons: MatchReason[], units: Units): string {
  return reasons.map((reason) => describeReason(reason, units)).join(' · ');
}

/** "4 km longer than you asked", "Hilly, not flat". */
export function describeMiss(miss: MatchMiss, units: Units): string {
  if (miss.kind === 'terrain') return `${TERRAIN_TEXT[miss.band]}, not ${TERRAIN_TEXT[miss.wanted].toLowerCase()}`;
  const amount = miss.unit === 'time' ? minutesText(Math.max(1, Math.round(miss.by / 60))) : formatDistanceShort(miss.by, units);
  return `${amount} ${miss.longer ? 'longer' : 'shorter'} than you asked`;
}

/** A run length as a choice reads: "45 min", "1.5 h", "10 km", "Half marathon". */
export function lengthText(length: RunLength, units: Units): string {
  if (length.kind === 'time') return length.minutes < 60 ? `${length.minutes} min` : `${length.minutes / 60} h`;
  return Math.abs(length.metres - HALF_MARATHON_M) < 1 ? 'Half marathon' : formatDistanceShort(length.metres, units);
}
