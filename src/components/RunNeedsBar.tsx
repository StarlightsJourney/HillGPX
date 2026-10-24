import type { RunLength, Terrain } from '../lib/routeMatch';
import { TERRAIN_TEXT } from '../lib/matchText';
import { formatDistanceIn, type Units } from '../lib/units';
import { useUnits } from './UnitsContext';
import { LocationArrowIcon } from './icons';

/** One mile in metres: imperial distance choices are whole miles (and a half marathon). */
const MILE_M = 1609.344;

const TIMES_MIN = [20, 30, 45, 60, 90, 120];
const DISTANCES: Record<Units, number[]> = {
  metric: [5_000, 10_000, 15_000, 21_097],
  imperial: [3 * MILE_M, 6 * MILE_M, 10 * MILE_M, 21_097],
};
const TERRAINS: Terrain[] = ['any', 'flat', 'rolling', 'hilly'];

/** The runner's needs when nothing has been chosen: one tap gives results. */
export const DEFAULT_RUN_LENGTH: RunLength = { kind: 'time', minutes: 45 };
export const DEFAULT_TERRAIN: Terrain = 'any';

function lengthKey(length: RunLength): string {
  return length.kind === 'time' ? `t${length.minutes}` : `d${Math.round(length.metres)}`;
}

function lengthFromKey(key: string): RunLength {
  const value = Number(key.slice(1));
  return key[0] === 't' ? { kind: 'time', minutes: value } : { kind: 'distance', metres: value };
}

export function lengthText(length: RunLength, units: Units): string {
  if (length.kind === 'time') return length.minutes < 60 ? `${length.minutes} min` : `${length.minutes / 60} h`;
  return Math.abs(length.metres - 21_097) < 1 ? 'Half marathon' : formatDistanceIn(length.metres, units).replace('.0 ', ' ');
}

interface RunNeedsBarProps {
  length: RunLength;
  terrain: Terrain;
  /** Where the ranking is measured from ("Near you", a country), or null before a plan. */
  whereLabel: string | null;
  /** Waiting for the location. */
  busy: boolean;
  onLength: (length: RunLength) => void;
  onTerrain: (terrain: Terrain) => void;
  onPlan: () => void;
  onClear: () => void;
}

/**
 * Routes mode's run planner: where, how long and what kind of run. Each has
 * a default, so "Rank routes" alone gives results; once ranked, changing a
 * choice re-ranks straight away and Clear goes back to plain browsing.
 */
export function RunNeedsBar({ length, terrain, whereLabel, busy, onLength, onTerrain, onPlan, onClear }: RunNeedsBarProps) {
  const { units } = useUnits();
  const planned = whereLabel != null;
  const lengths: RunLength[] = [
    ...TIMES_MIN.map((minutes): RunLength => ({ kind: 'time', minutes })),
    ...DISTANCES[units].map((metres): RunLength => ({ kind: 'distance', metres: Math.round(metres) })),
  ];
  if (!lengths.some((option) => lengthKey(option) === lengthKey(length))) lengths.push(length);

  return (
    <section className={`run-needs${planned ? ' planned' : ''}`} aria-label="Plan a run">
      <button
        type="button"
        className={`chip run-need${planned ? ' on' : ''}`}
        onClick={onPlan}
        disabled={busy}
        aria-label={planned ? `Where: ${whereLabel}. Locate again` : 'Where: near me'}
      >
        <LocationArrowIcon size={14} />
        {busy ? 'Locating…' : whereLabel ?? 'Near me'}
      </button>
      <label className={`chip run-need run-need-select${planned ? ' on' : ''}`}>
        <span className="visually-hidden">How long</span>
        <select aria-label="How long" value={lengthKey(length)} onChange={(e) => onLength(lengthFromKey(e.target.value))}>
          {lengths.map((option) => (
            <option key={lengthKey(option)} value={lengthKey(option)}>
              {lengthText(option, units)}
            </option>
          ))}
        </select>
      </label>
      <label className={`chip run-need run-need-select${planned ? ' on' : ''}`}>
        <span className="visually-hidden">What kind</span>
        <select aria-label="What kind" value={terrain} onChange={(e) => onTerrain(e.target.value as Terrain)}>
          {TERRAINS.map((option) => (
            <option key={option} value={option}>
              {TERRAIN_TEXT[option]}
            </option>
          ))}
        </select>
      </label>
      {planned ? (
        <button type="button" className="linkish run-needs-clear" onClick={onClear}>
          Clear
        </button>
      ) : (
        <button type="button" className="btn btn-dark run-needs-go" onClick={onPlan} disabled={busy}>
          Rank routes
        </button>
      )}
    </section>
  );
}
