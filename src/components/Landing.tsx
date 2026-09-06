interface LandingProps {
  onOpen: () => void;
}

/**
 * Landing page.
 *
 * Deliberately one screen: a headline, a sentence, and a button. Anyone arriving
 * here wants the map, so the only job is to get them into it without making them
 * read. The map bundle is code-split, so this page paints without downloading
 * MapLibre at all — the click below is what pulls it in.
 */
export function Landing({ onOpen }: LandingProps) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="wordmark">
          hill<span className="dot">GPX</span>
        </span>
        <a href="https://github.com/StarlightsJourney/hillGPX" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      <main className="landing-hero">
        <h1>Find the climb.</h1>
        <p className="lede">
          Every hill, staircase and tall block in Singapore worth training elevation gain on —
          mapped, measured, and free.
        </p>

        <button className="cta" onClick={onOpen}>
          Open the map
        </button>

        <RidgeGraphic />

        <ul className="landing-points">
          <li>
            <strong>Real elevation.</strong> Drop in a GPX and get a profile computed against a
            terrain model, not the noisy altitude your watch recorded.
          </li>
          <li>
            <strong>Nothing leaves your browser.</strong> Files you open are parsed in the tab.
            There is no server to upload them to.
          </li>
          <li>
            <strong>Open data.</strong> Every venue and route lives in the repo. Fix a wrong
            height with a pull request.
          </li>
        </ul>
      </main>

      <footer className="landing-foot small muted">
        <span>
          Open source, MIT. Building data from{' '}
          <a href="https://data.gov.sg" target="_blank" rel="noreferrer">
            data.gov.sg
          </a>
          . Map by{' '}
          <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>
          .
        </span>
      </footer>
    </div>
  );
}

/**
 * A ridgeline standing in for a screenshot. Inline SVG rather than an image so
 * the page stays a single request and scales to any width without a media query.
 */
function RidgeGraphic() {
  return (
    <svg className="ridge" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="ridgeFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ridgeNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <path
        d="M0 190 L120 140 L230 165 L340 96 L470 150 L600 70 L730 138 L860 104 L1000 156 L1120 120 L1200 148 L1200 220 L0 220 Z"
        fill="url(#ridgeFar)"
      />
      <path
        d="M0 212 L150 176 L280 198 L410 150 L540 190 L680 128 L820 182 L960 152 L1090 196 L1200 174 L1200 220 L0 220 Z"
        fill="url(#ridgeNear)"
      />
      <path
        d="M0 190 L120 140 L230 165 L340 96 L470 150 L600 70 L730 138 L860 104 L1000 156 L1120 120 L1200 148"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        opacity="0.75"
      />
    </svg>
  );
}
