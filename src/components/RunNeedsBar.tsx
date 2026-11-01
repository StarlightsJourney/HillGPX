import { LocationArrowIcon } from './icons';

interface RunNeedsBarProps {
  /** Where the ranking is measured from ("Near you", a country), or null before a plan. */
  whereLabel: string | null;
  /** Waiting for the location. */
  busy: boolean;
  onPlan: () => void;
  onClear: () => void;
}

/**
 * Routes mode's run planner: one tap on Where ranks the routes. Clear goes
 * back to plain browsing.
 */
export function RunNeedsBar({ whereLabel, busy, onPlan, onClear }: RunNeedsBarProps) {
  const planned = whereLabel != null;

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
      {planned && (
        <button type="button" className="linkish run-needs-clear" onClick={onClear}>
          Clear
        </button>
      )}
    </section>
  );
}
