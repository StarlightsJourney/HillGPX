import { useEffect, useState, type ReactNode } from 'react';
import { compactCount, formatShare } from '../lib/coverage';
import { useCoverage } from './Coverage';

/**
 * Community GPX milestones. Each tier is a shared achievement: the whole
 * community unlocks it together, so every upload visibly moves the bar.
 */
export const MILESTONES: { count: number; name: string }[] = [
  { count: 10, name: 'First tracks' },
  { count: 25, name: 'Trailhead' },
  { count: 50, name: 'Ridge line' },
  { count: 100, name: 'Summit push' },
  { count: 250, name: 'Range' },
  { count: 500, name: 'Expedition' },
  { count: 1000, name: 'World map' },
  { count: 5000, name: 'Every hill' },
];

function progressOf(routes: number) {
  const index = MILESTONES.findIndex((m) => routes < m.count);
  const next = index === -1 ? null : MILESTONES[index];
  const previous = index <= 0 ? 0 : MILESTONES[index - 1].count;
  const share = next ? (routes - previous) / (next.count - previous) : 1;
  return { next, index: index === -1 ? MILESTONES.length : index, share: Math.max(0, Math.min(1, share)) };
}

function Medal({ unlocked }: { unlocked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={unlocked ? 'medal on' : 'medal'}>
      <path d="M4.5 1h3l.7 3.4H5.6zM8.5 1h3l-.9 3.4H7.8z" fill="currentColor" opacity="0.55" />
      <circle cx="8" cy="10" r="4.6" fill="currentColor" />
      <path d="m8 7.6.8 1.5 1.7.3-1.2 1.2.3 1.7L8 11.5l-1.6.8.3-1.7-1.2-1.2 1.7-.3z" fill="#fff" opacity="0.9" />
    </svg>
  );
}

const ROTATE_MS = 4200;

/**
 * The community's progress, on every page: a slim strip under the header.
 * It cycles through a few live facts (always leading with how much is mapped
 * and how little has a GPX), and hovering or tapping drops down the full
 * milestone ladder.
 */
export function MilestoneBar() {
  const coverage = useCoverage();
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (open || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setSlide((n) => n + 1), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!coverage) return <div className="mile-bar loading" aria-hidden="true" />;
  const { next, index, share } = progressOf(coverage.routes);
  const remaining = next ? next.count - coverage.routes : 0;
  // Plain statements of fact, one at a time.
  const messages: ReactNode[] = [
    <><strong>{coverage.summits.toLocaleString()}</strong> hills on the map. <strong>{coverage.placesWithRoutes.toLocaleString()}</strong> have a GPX.</>,
    next ? <><strong>{remaining}</strong> more {remaining === 1 ? 'route' : 'routes'} to reach <em>{next.name}</em>.</> : <>All milestones reached.</>,
    <><strong>{coverage.routes}</strong> routes shared in <strong>{coverage.countries}</strong> countries.</>,
    <><strong>{coverage.placesWithPhotos.toLocaleString()}</strong> places have a photo.</>,
  ];
  // The headline fact comes round every other slide.
  const current = slide % 2 === 0 ? 0 : 1 + (Math.floor(slide / 2) % (messages.length - 1));

  return (
    <div className={`mile-bar${open ? ' open' : ''}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="mile-bar-row">
        <button type="button" className="mile-bar-main" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Medal unlocked={index > 0} />
          <span className="mile-bar-ticker" aria-live="polite">
            <span key={current} className="mile-bar-text">{messages[current]}</span>
          </span>
          <span className="mile-bar-track" aria-hidden="true">
            <span style={{ width: `${Math.max(share * 100, 4)}%` }} />
          </span>
          <span className="mile-bar-count">{coverage.routes}/{next?.count ?? coverage.routes}</span>
        </button>
      </div>

      {open && (
        <div className="mile-bar-drop">
          <div className="mile-bar-panel">
            <div className="mile-bar-headline">
              <div>
                <strong>{compactCount(coverage.summits)}</strong>
                <span>hills in {coverage.countries} countries</span>
              </div>
              <div>
                <strong>{coverage.placesWithRoutes.toLocaleString()}</strong>
                <span>with a GPX ({formatShare(coverage.gpxShare)})</span>
              </div>
              <div>
                <strong>{coverage.placesWithPhotos.toLocaleString()}</strong>
                <span>with a photo ({formatShare(coverage.photoShare)})</span>
              </div>
            </div>
            <ol className="mile-steps">
              {MILESTONES.map((milestone, i) => (
                <li key={milestone.count} className={i < index ? 'done' : i === index ? 'current' : ''}>
                  <Medal unlocked={i < index} />
                  <span>{milestone.name}</span>
                  <small>{milestone.count.toLocaleString()}</small>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
