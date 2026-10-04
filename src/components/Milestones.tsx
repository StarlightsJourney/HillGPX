import { useEffect, useState, type ReactNode } from 'react';
import { compactCount, routeGoal } from '../lib/coverage';
import { prefersReducedMotion } from '../lib/dom';
import { CoverageModal, useCountUp, useCoverage } from './Coverage';
import { ChevronRightIcon } from './icons';

const TICK_MS = 4200;

/**
 * The top strip on every page: how many GPX routes the community has shared
 * out of the next round-number goal, as a filled bar. On arrival the count
 * runs up and the bar fills; then the line beside it rolls through a few
 * short facts (the goal, what is left, how much of the map has a GPX, an
 * invitation). It pauses while hovered or focused and stays on the first
 * line under reduced motion. Nothing opens on hover; a click opens
 * "What's mapped".
 *
 * Fixed height (`--goal-bar-h`), loading included, so the sticky landing
 * header never changes size.
 */
export function MilestoneBar() {
  const coverage = useCoverage();
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const shared = useCountUp(coverage?.routes ?? 0, 1100);

  useEffect(() => {
    if (!coverage || paused || open || prefersReducedMotion()) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [coverage, paused, open]);

  if (!coverage) return <div className="goal-bar loading" aria-hidden="true" />;

  const { goal, remaining, share } = routeGoal(coverage.routes);
  const lines: ReactNode[] = [
    <>
      <strong>
        {shared.toLocaleString()} of {goal.toLocaleString()}
      </strong>{' '}
      GPX routes shared
    </>,
    <>
      <strong>{remaining.toLocaleString()} to go</strong> to the next goal of {goal.toLocaleString()}
    </>,
    <>
      <strong>{compactCount(coverage.summits)}</strong> hills mapped, <strong>{coverage.placesWithRoutes.toLocaleString()}</strong> with a GPX
    </>,
    <>
      Ran one? <strong>Share the GPX</strong>, free for everyone
    </>,
  ];
  const index = tick % lines.length;

  return (
    <div className="goal-bar">
      <button
        type="button"
        className="goal-bar-main"
        aria-haspopup="dialog"
        aria-label={`${coverage.routes} of ${goal} GPX routes shared, ${remaining} to go to the next goal. Open what's mapped.`}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <span className="goal-bar-ticker" aria-hidden="true">
          <span key={index} className="goal-bar-line">
            {lines[index]}
          </span>
        </span>
        <span className="goal-bar-track" aria-hidden="true">
          <span style={{ '--goal-share': share } as React.CSSProperties} />
        </span>
        <ChevronRightIcon size={12} />
      </button>
      {open && <CoverageModal coverage={coverage} onClose={() => setOpen(false)} />}
    </div>
  );
}
