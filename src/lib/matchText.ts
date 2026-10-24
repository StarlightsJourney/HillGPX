/**
 * Words for the run planner's choices (RunNeedsBar and the ranked list's
 * heading), in the visitor's units.
 */
import { HALF_MARATHON_M, type RunLength, type Terrain } from './routeMatch';
import { formatDistanceShort, type Units } from './units';

export const TERRAIN_TEXT: Record<Terrain, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  any: 'Any terrain',
};

/** A run length as a choice reads: "45 min", "1.5 h", "10 km", "Half marathon". */
export function lengthText(length: RunLength, units: Units): string {
  if (length.kind === 'time') return length.minutes < 60 ? `${length.minutes} min` : `${length.minutes / 60} h`;
  return Math.abs(length.metres - HALF_MARATHON_M) < 1 ? 'Half marathon' : formatDistanceShort(length.metres, units);
}
