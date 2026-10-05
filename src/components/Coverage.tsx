import { useEffect, useId, useState } from 'react';
import { communityStats } from '../lib/api';
import { ROUTE_GOALS, computeCoverage, formatShare, routeGoal, type Coverage } from '../lib/coverage';
import { prefersReducedMotion } from '../lib/dom';
import { loadDataset } from '../lib/venues';
import { loadPeakIndex } from '../lib/worldPeaks';
import { CheckIcon, UploadIcon } from './icons';
import { CategoryIcon } from './FilterBar';
import { openImportHere } from '../lib/contribute';
import { Modal } from './Modal';

/** Coverage numbers, loaded once and shared by everything that shows them. */
export function useCoverage(): Coverage | null {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDataset(), loadPeakIndex(), communityStats()])
      .then(([dataset, index, stats]) => {
        if (!cancelled) setCoverage(computeCoverage(dataset, index, stats));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return coverage;
}

/** Counts up from 0 to `target` with an ease-out; lands on the number at once under reduced motion. */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const reduced = prefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);
  return reduced ? target : value;
}

function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value).toLocaleString()}</>;
}


/** The share of the current goal as a ring, the count in the middle. */
function GoalRing({ routes, goal, share }: { routes: number; goal: number; share: number }) {
  const gradient = `ring${useId().replace(/:/g, '')}`;
  const r = 44;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="cov-ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f08a62" />
            <stop offset="1" stopColor="#c1502e" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} className="cov-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="cov-ring-fill"
          stroke={`url(#${gradient})`}
          strokeDasharray={circumference}
          style={{ '--ring-offset': `${circumference * (1 - share)}`, '--ring-full': `${circumference}` } as React.CSSProperties}
        />
      </svg>
      <span className="cov-ring-count">
        <strong><CountUp value={routes} /></strong>
        <small>of {goal.toLocaleString()}</small>
      </span>
    </div>
  );
}

/**
 * The goals around where the community is now, as one track: the last goal
 * reached, the next (with the line into it filled as far as the count has
 * got), and a few beyond.
 */
function GoalSteps({ routes, goal }: { routes: number; goal: number }) {
  const ladder: number[] = ROUTE_GOALS.includes(goal as (typeof ROUTE_GOALS)[number]) ? [...ROUTE_GOALS] : [...ROUTE_GOALS, goal];
  const at = ladder.indexOf(goal);
  const start = Math.max(0, Math.min(at - 1, ladder.length - 5));
  const steps = ladder.slice(start, start + 5);
  const previous = at > 0 ? ladder[at - 1] : 0;
  const leg = Math.min(1, Math.max(0, (routes - previous) / (goal - previous)));
  return (
    <ol className="cov-steps" aria-label="Route goals">
      {steps.map((count, i) => {
        const state = routes >= count ? 'done' : count === goal ? 'current' : 'next';
        return (
          <li
            key={count}
            className={state}
            style={{ '--i': i, '--leg': `${leg * 100}%` } as React.CSSProperties}
            aria-label={`${count.toLocaleString()} routes${state === 'done' ? ', reached' : state === 'current' ? ', next goal' : ''}`}
          >
            <span className="cov-step-dot" aria-hidden="true">{state === 'done' && <CheckIcon size={10} />}</span>
            <span className="cov-step-label" aria-hidden="true">{count.toLocaleString()}</span>
            {state === 'current' && <span className="cov-step-tag" aria-hidden="true">Next goal</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Meter({ label, count, share }: { label: string; count: number; share: number }) {
  return (
    <div className="coverage-meter">
      <div className="coverage-meter-head">
        <span>{label}</span>
        <strong>
          <CountUp value={count} /> <small>· {formatShare(share)}</small>
        </strong>
      </div>
      <div className="coverage-meter-track" aria-hidden="true">
        <span style={{ width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}

/**
 * The one "what's mapped" sheet, opened from the goal strip at the top of
 * every page: the community route goal as a ring and a row of milestones,
 * then how much of the map is filled in. Without `onUpload`, "Add a GPX"
 * follows the #import link like the header button does.
 */
export function CoverageModal({ coverage, onClose, onUpload }: { coverage: Coverage; onClose: () => void; onUpload?: () => void }) {
  const { routes, goal, remaining, share } = routeGoal(coverage.routes);
  const cta = (
    <>
      <UploadIcon size={16} />
      Add a GPX
    </>
  );
  return (
    <Modal
      title="What's mapped"
      onClose={onClose}
      footer={
        <>
          <span className="cov-foot-note">Every route is free to download.</span>
          {onUpload ? (
            <button type="button" className="btn btn-accent" onClick={onUpload}>{cta}</button>
          ) : (
            <a className="btn btn-accent" href="#import" onClick={(event) => { onClose(); openImportHere(event); }}>{cta}</a>
          )}
        </>
      }
    >
      <section className="cov-hero" aria-label="Community goal">
        <GoalRing routes={routes} goal={goal} share={share} />
        <div className="cov-hero-copy">
          <span className="cov-kicker">Community goal</span>
          <strong>
            {remaining.toLocaleString()} route{remaining === 1 ? '' : 's'} to go
          </strong>
          <p>
            {routes.toLocaleString()} of {goal.toLocaleString()} GPX routes shared so far. Share one from your watch and it goes on the map for everyone.
          </p>
        </div>
        <svg className="cov-hero-ridge" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 60V42l40-14 30 10 46-26 38 20 30-8 52 22 40-30 44 24 36-10 44 18v12z" />
        </svg>
      </section>

      <GoalSteps routes={routes} goal={goal} />

      <div className="cov-stats">
        <div>
          <span className="cov-stat-icon"><CategoryIcon id="hill" /></span>
          <strong><CountUp value={coverage.summits} /></strong>
          <span>summits</span>
        </div>
        <div>
          <span className="cov-stat-icon"><CategoryIcon id="globe" /></span>
          <strong><CountUp value={coverage.countries} /></strong>
          <span>countries</span>
        </div>
        <div>
          <span className="cov-stat-icon"><CategoryIcon id="hdb_block" /></span>
          <strong><CountUp value={coverage.builtClimbs} /></strong>
          <span>stairs and blocks</span>
        </div>
      </div>

      <Meter label="Places with a GPX" count={coverage.placesWithRoutes} share={coverage.gpxShare} />
      <Meter label="Places with a photo" count={coverage.placesWithPhotos} share={coverage.photoShare} />
      <div className="coverage-row">
        <span>Reviews</span>
        <strong><CountUp value={coverage.reviews} /></strong>
      </div>
    </Modal>
  );
}
