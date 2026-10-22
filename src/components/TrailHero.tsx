import { openMapWith } from '../lib/mapIntent';
import { LocateIcon, MapIcon } from './icons';

/**
 * Where each step sits on the drawn trail, in the SVG's 1000 × 140 box: x as
 * a share of the width (each step is centred over its third of the page) and
 * y in pixels, read off the path below at that x.
 */
const STEPS = [
  { x: 16.7, y: 72, title: 'Search a place', text: 'A town, a country or a summit, or use your location.' },
  { x: 50, y: 40, title: 'Check the route', text: 'Distance, elevation gain and the full profile before you go.' },
  { x: 83.3, y: 60, title: 'Take the GPX', text: "Download it to your watch, or share one you've run." },
];

/** A ridge from the start (left, low) through the three steps to the summit flag (right, high). */
const TRAIL = 'M10 112 C 60 108, 110 76, 167 72 S 250 104, 300 100 S 420 44, 500 40 S 600 92, 650 96 S 770 64, 833 60 S 940 34, 990 28';

/** Contours of the real ground around Bukit Timah (scripts/render_hero_contours.py). */
const CONTOURS = `${import.meta.env.BASE_URL}hero/bukit-timah-contours.svg`;

/**
 * The landing page's hero, shown on every visit: one line of promise, what
 * the site is, the two ways in, and how it works as three steps on a trail
 * that draws itself from the start to the summit. On phones the trail turns
 * into a vertical line down the steps. Under reduced motion it is drawn
 * already. Behind it all, faint, the contour lines of Bukit Timah.
 */
export function TrailHero() {
  return (
    <section className="trail-hero">
      <img className="trail-hero-bg" src={CONTOURS} alt="" aria-hidden="true" decoding="async" />
      <div className="home-shell">
        <h1 className="trail-hero-title">
          May the <span>trail</span> be with you
        </h1>
        <p className="trail-hero-lead">
          Hills, mountains, stairs and tall blocks worldwide, with free GPX routes and honest elevation.
        </p>
        <div className="trail-hero-actions">
          <button type="button" className="btn btn-dark" onClick={() => openMapWith({ kind: 'near-me' })}>
            <LocateIcon size={16} />
            Routes near me
          </button>
          <a className="btn btn-light" href="#map">
            <MapIcon size={16} />
            Browse the map
          </a>
        </div>

        <div className="trail">
          <svg className="trail-line" viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="trail-ghost" d={TRAIL} />
            <path className="trail-path" d={TRAIL} pathLength={1} />
          </svg>
          <span className="trail-end start" aria-hidden="true" />
          <span className="trail-end finish" aria-hidden="true">
            <svg viewBox="0 0 16 20" width="16" height="20" focusable="false">
              <path d="M2 19V2M2 3h11l-3 3.5L13 10H2" />
            </svg>
          </span>
          <ol className="trail-steps" aria-label="How it works">
            {STEPS.map((step, i) => (
              <li key={step.title} style={{ '--x': step.x, '--y': step.y, '--i': i } as React.CSSProperties}>
                <span className="trail-dot" aria-hidden="true">{i + 1}</span>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
