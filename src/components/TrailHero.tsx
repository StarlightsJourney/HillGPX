import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { prefersReducedMotion } from '../lib/dom';
import { openImportHere } from '../lib/contribute';
import { openMapWith } from '../lib/mapIntent';
import { LocateIcon, SearchIcon, UploadIcon } from './icons';
import { focusSiteSearch } from './SearchBar';

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

/** The real ground around Bukit Timah as a topo map (scripts/render_hero_contours.py). */
const HERO_MAP = `${import.meta.env.BASE_URL}hero/bukit-timah`;

interface ContourMap {
  width: number;
  height: number;
  /** Each line with its length in the map's units, which tracing it in needs. */
  lines: { d: string; index: boolean; length: number }[];
}

/** The contour lines, fetched after the page (they are decoration, ~60 KB). */
function useContours(): ContourMap | null {
  const [map, setMap] = useState<ContourMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${HERO_MAP}-contours.json`)
      .then((response) => (response.ok ? (response.json() as Promise<ContourMap>) : null))
      .then((data) => {
        if (!cancelled && data) setMap(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}

/**
 * The map behind the hero: height tints, then the contour lines, which trace
 * themselves in on arrival. With a mouse, the layers lean towards the pointer
 * by different amounts (`--px`, `--py`), so the map has depth.
 */
function HeroMap({ mapRef }: { mapRef: React.RefObject<HTMLDivElement> }) {
  const contours = useContours();
  return (
    <div className="trail-hero-map" ref={mapRef} aria-hidden="true">
      <img className="tints" src={`${HERO_MAP}-tint.png`} alt="" decoding="async" />
      {contours && (
        <svg className="lines" viewBox={`0 0 ${contours.width} ${contours.height}`} preserveAspectRatio="xMidYMid slice" focusable="false">
          {contours.lines.map((line, i) => (
            <path key={i} d={line.d} className={line.index ? 'index' : undefined} style={{ '--l': line.length } as React.CSSProperties} />
          ))}
        </svg>
      )}
    </div>
  );
}

/** Pointer position over the hero as -0.5…0.5 each way, written straight to CSS (no re-render). */
function useParallax() {
  const mapRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const enabled = useRef(false);
  useEffect(() => {
    enabled.current = window.matchMedia('(hover: hover) and (pointer: fine)').matches && !prefersReducedMotion();
    return () => cancelAnimationFrame(frame.current);
  }, []);
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!enabled.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      mapRef.current?.style.setProperty('--px', x.toFixed(3));
      mapRef.current?.style.setProperty('--py', y.toFixed(3));
    });
  };
  const leave = () => {
    cancelAnimationFrame(frame.current);
    mapRef.current?.style.setProperty('--px', '0');
    mapRef.current?.style.setProperty('--py', '0');
  };
  return { mapRef, move, leave };
}

/**
 * "Search by Region": back to the top and into the header search, with its
 * suggestions open. The focus happens in this same click, so phones open the
 * keyboard; the scroll is instant under reduced motion.
 */
function searchByRegion() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  focusSiteSearch();
}

/**
 * The landing page's hero, shown on every visit: one line of promise, what
 * the site is, three ways in (near me, search, upload), and how it works as three steps on a trail
 * that draws itself from the start to the summit. On phones the trail turns
 * into a vertical line down the steps. Under reduced motion it is drawn
 * already. Behind it all, a live topographic map of Bukit Timah (HeroMap).
 */
export function TrailHero() {
  const { mapRef, move, leave } = useParallax();
  return (
    <section className="trail-hero" onPointerMove={move} onPointerLeave={leave}>
      <HeroMap mapRef={mapRef} />
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
          <button type="button" className="btn btn-light" onClick={searchByRegion}>
            <SearchIcon size={16} />
            Search by Region
          </button>
          <a className="btn btn-light" href="#import" onClick={openImportHere}>
            <UploadIcon size={16} />
            Upload GPX
          </a>
        </div>

        <div className="hero-trail">
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
