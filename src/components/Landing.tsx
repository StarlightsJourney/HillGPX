import { useEffect, useState } from 'react';
import { GitHubIcon, MapIcon, Mark, UploadIcon } from './icons';
import { useUnits } from './UnitsContext';

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
            <h1>Train vertical in Singapore</h1>
            <p className="lp-lede">
              Every hill, staircase and tall block worth climbing — with honest elevation profiles
              from your own GPX files.
            </p>
            <div className="lp-actions">
              <button className="cta" onClick={onOpen}>
                <MapIcon size={18} />
                Open map
              </button>
              <a className="cta-secondary" href="#how-it-works">
                How it works
              </a>
            </div>
            <div className="lp-hero-stats" aria-label="What is on the map">
              <Figure value={blocks != null ? formatCount(blocks) : '—'} label="HDB blocks" />
              <Figure value={hills != null ? formatCount(hills) : '—'} label="Hills & summits" />
              <Figure value={stats ? String(stats.routes) : '—'} label="Routes" />
            </div>
          </section>
        </div>

        <Transect stats={stats} />

        <div className="shell" id="how-it-works">
          <section className="lp-how">
            <h2>How it works</h2>
            <div className="lp-steps">
              <StepCard
                number={1}
                title="Find a climb"
                body="Search hills, public staircases and HDB blocks near you. Heights are ranked by real elevation gain, not just summit altitude."
                icon={<MapIcon size={22} />}
              />
              <StepCard
                number={2}
                title="Drop your GPX"
                body="Import a route from your watch or Strava. We re-sample it against the terrain model so the profile is honest — no upload, no account."
                icon={<UploadIcon size={22} />}
              />
              <StepCard
                number={3}
                title="Contribute back"
                body="A wrong height is a one-line fix and a new route is one GPX file. Everything lives in the open repository."
                icon={<GitHubIcon size={22} />}
              />
            </div>
          </section>

          <section className="lp-note">
            <p>
              Built for training elevation in a city with no mountains. Open data — fix a height or
              add a route on{' '}
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
              .
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

function StepCard({
  number,
  title,
  body,
  icon,
}: {
  number: number;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="lp-step">
      <div className="lp-step-icon" aria-hidden="true">
        {icon}
      </div>
      <span className="lp-step-number">Step {number}</span>
      <h3>{title}</h3>
      <p>{body}</p>
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
  const units = useUnits();
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
        {/* The figure and its unit are wrapped rather than joined with a
            non-breaking space, because the string now comes back formatted and
            patching a character into it would be the caller second-guessing the
            formatter. */}
        Singapore&rsquo;s terrain, west to east. Highest ground{' '}
        <span className="nowrap">{units.height(peak)}</span>.
      </figcaption>
    </figure>
  );
}
