import { useEffect, useState } from 'react';
import { GitHubIcon, Mark } from './icons';

const REPO_URL = 'https://github.com/StarlightsJourney/HillGPX';

interface LandingProps {
  onOpen: () => void;
}

interface Stats {
  venues: number;
  byType: Record<string, number>;
  routes: number;
  demSamples: number;
  transect: number[];
  transectLabel: string;
}

/**
 * Landing page.
 *
 * Restrained on purpose: a tool page, not a pitch. Type tops out well below
 * display sizes, weight stays at 600, and the only saturated colour on the page
 * is the terrain line. The figures and that terrain profile are both generated
 * by build_data.py, so nothing here can drift out of step with the data.
 *
 * The map bundle is code-split, so this renders without downloading MapLibre.
 */
export function Landing({ onOpen }: LandingProps) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/stats.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => undefined);
  }, []);

  const blocks = stats?.byType.hdb_block ?? null;
  const hills = stats
    ? (stats.byType.hill ?? 0) + (stats.byType.park ?? 0) + (stats.byType.stairs ?? 0)
    : null;

  return (
    <div className="landing">
      <div className="shell">
        <header className="lp-nav">
          <span className="wordmark">
            <Mark />
            <span>
              hill<span className="dot">GPX</span>
            </span>
          </span>
          <a
            className="icon-link"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="View the source on GitHub"
            title="View the source on GitHub"
          >
            <GitHubIcon />
          </a>
        </header>
      </div>

      <main>
        <div className="shell">
          <section className="lp-hero">
            <h1>Every hill and tall block in Singapore</h1>
            <p className="lp-lede">
              Mapped by height, so you can find a climb near you.
            </p>
            <button className="cta" onClick={onOpen}>
              Open the map
            </button>
          </section>
        </div>

        <Transect stats={stats} />

        <div className="shell">
          <section className="lp-stats" aria-label="What is on the map">
            <Figure value={blocks != null ? formatCount(blocks) : '—'} label="HDB blocks" />
            <Figure value={hills != null ? String(hills) : '—'} label="Hills & staircases" />
            <Figure value={stats ? String(stats.routes) : '—'} label="Routes" />
          </section>

          <section className="lp-note">
            <h2>Why</h2>
            <p>
              I wanted a tall HDB block near me to train stairs on, and there was no way to look one
              up. So I mapped every block in Singapore by height, then added the hills.
            </p>
            <p>
              It is free and community-run. Every hill, block and route is a file in a public
              repository, so a wrong height is a one-line fix and adding a route is one GPX.{' '}
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                Contribute on GitHub
              </a>
            </p>
          </section>
        </div>
      </main>

      <div className="shell">
        <footer className="lp-foot">
          <span className="small muted">MIT licensed</span>
          <span className="small muted">
            <a href="https://data.gov.sg" target="_blank" rel="noreferrer">
              data.gov.sg
            </a>
            <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
              OpenFreeMap
            </a>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="lp-figure">
      <span className="lp-figure-value">{value}</span>
      <span className="lp-figure-label">{label}</span>
    </div>
  );
}

function formatCount(n: number): string {
  return n.toLocaleString('en-SG');
}

/**
 * The real terrain of Singapore — for each step west to east, the highest ground
 * in the latitude band, sampled from the same model the app uses for elevation
 * profiles. The product's own output rather than an illustration, which is the
 * only reason it earns the space.
 */
function Transect({ stats }: { stats: Stats | null }) {
  const points = stats?.transect ?? [];
  // Reserve the space up front so the page does not jump when stats arrive.
  if (points.length < 2) return <div className="lp-transect" aria-hidden="true" />;

  const W = 1000;
  const H = 150;
  const peak = Math.max(...points, 1);
  const scale = H / (peak * 1.12); // headroom so the summit clears the top edge

  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - v * scale;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  const line = `M${coords.join(' L')}`;
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  return (
    <figure className="lp-transect">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={stats!.transectLabel}
      >
        <path d={area} className="transect-fill" />
        <path d={line} className="transect-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="small muted">
        Singapore&rsquo;s terrain, west to east. Highest ground {peak}&nbsp;m.
      </figcaption>
    </figure>
  );
}
