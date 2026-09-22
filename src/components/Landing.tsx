import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route, Venue } from '../types';
import { loadDataset, rankingHeight, venueHeight, VENUE_TYPE_LABEL, type Dataset } from '../lib/venues';
import { DESTINATIONS, boundsToHash, regionOf, type Destination } from '../lib/regions';
import { addPlaceUrl, addRouteUrl, REPO_URL } from '../lib/contribute';
import { routeDifficulty } from '../lib/routes';
import { ChevronLeftIcon, ChevronRightIcon, GitHubIcon, Mark, SearchIcon } from './icons';
import { HeaderControls } from './HeaderControls';
import { RatingLabel } from './ResultsList';
import { RouteThumb } from './RouteThumb';
import { VenueThumb } from './VenueThumb';
import { useUnits } from './UnitsContext';

interface LandingProps {
  onOpen: () => void;
}

type Mode = 'climbs' | 'routes';

function openMap(mode: Mode, hash = '#map') {
  sessionStorage.setItem('hillgpx:mode', mode);
  window.location.hash = hash;
}

/**
 * The front door, modelled on Airbnb's home: a header with the two things you
 * can browse, one search that takes you somewhere, and rows of real listings
 * underneath. No hero copy to read — the rows are the pitch.
 */
export function Landing({ onOpen }: LandingProps) {
  const [mode, setMode] = useState<Mode>('climbs');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    loadDataset().then(setDataset).catch(() => undefined);
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const rows = useMemo(() => (dataset ? buildRows(dataset.venues) : null), [dataset]);
  const routes = useMemo(
    () => (dataset ? [...dataset.routes].sort((a, b) => b.gainM - a.gainM) : null),
    [dataset],
  );

  return (
    <div className="home">
      <header className={`home-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="home-shell home-nav-row">
          <a className="wordmark" href="#">
            <Mark size={30} />
            <span>
              hill<span className="dot">GPX</span>
            </span>
          </a>
          <nav className="home-tabs" aria-label="Browse">
            {(['climbs', 'routes'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`home-tab${mode === value ? ' on' : ''}`}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                <span className="home-tab-icon" aria-hidden="true">
                  {value === 'climbs' ? <HillArt /> : <RouteArt />}
                </span>
                {value === 'climbs' ? 'Climbs' : 'Routes'}
              </button>
            ))}
          </nav>
          <div className="home-nav-actions">
            <a className="home-nav-link" href={addRouteUrl()} target="_blank" rel="noreferrer">
              Share a route
            </a>
            <HeaderControls />
          </div>
        </div>
        <div className="home-shell">
          <HomeSearch mode={mode} onModeChange={setMode} onOpen={onOpen} />
        </div>
      </header>

      <main className="home-shell home-main">
        {mode === 'routes' ? (
          <>
            <Row title="Routes worth running" action={() => openMap('routes', '#routes')} loading={!routes}>
              {routes?.map((route, i) => <RouteTile key={route.slug} route={route} index={i} />)}
            </Row>
            <ContributeBanner />
          </>
        ) : (
          <>
            {routes && routes.length > 0 && (
              <Row title="Routes worth running" action={() => openMap('routes', '#routes')} loading={false}>
                {routes.map((route, i) => <RouteTile key={route.slug} route={route} index={i} />)}
              </Row>
            )}
            {(rows ?? PLACEHOLDER_ROWS).map((row) => (
              <Row
                key={row.title}
                title={row.title}
                action={row.bounds ? () => openMap('climbs', boundsToHash(row.bounds!)) : onOpen}
                loading={!rows}
              >
                {row.venues.map((venue, i) => <VenueTile key={venue.slug} venue={venue} index={i} />)}
              </Row>
            ))}
            <ContributeBanner />
          </>
        )}
      </main>

      <footer className="home-foot">
        <div className="home-shell home-foot-row">
          <span>
            © hillGPX · MIT ·{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Source
            </a>
          </span>
          <span className="home-foot-credits">
            Data from <a href="https://data.gov.sg" target="_blank" rel="noreferrer">data.gov.sg</a>,{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> and{' '}
            <a href="https://www.mapillary.com" target="_blank" rel="noreferrer">Mapillary</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ─── Search ──────────────────────────────────────────────────────────── */

function HomeSearch({ mode, onModeChange, onOpen }: { mode: Mode; onModeChange: (m: Mode) => void; onOpen: () => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLFormElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? DESTINATIONS.filter((d) => `${d.name} ${d.hint}`.toLowerCase().includes(q)) : DESTINATIONS;
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (destination?: Destination) => {
    if (destination) openMap(mode, boundsToHash(destination.bounds));
    else if (matches[0] && query.trim()) openMap(mode, boundsToHash(matches[0].bounds));
    else {
      sessionStorage.setItem('hillgpx:mode', mode);
      onOpen();
    }
  };

  return (
    <form
      ref={rootRef}
      className={`home-search${open ? ' focused' : ''}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(open ? matches[active] : undefined);
      }}
    >
      <label className="home-search-field home-search-where">
        <span className="home-search-label">Where</span>
        <input
          value={query}
          placeholder="Search destinations"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Escape') setOpen(false);
          }}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="home-search-list"
        />
      </label>
      <span className="home-search-sep" aria-hidden="true" />
      <div className="home-search-field home-search-what">
        <span className="home-search-label">Looking for</span>
        <div className="home-search-toggle" role="radiogroup" aria-label="Looking for">
          {(['climbs', 'routes'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className={mode === value ? 'on' : ''}
              onClick={() => onModeChange(value)}
            >
              {value === 'climbs' ? 'Climbs' : 'Routes'}
            </button>
          ))}
        </div>
      </div>
      <button type="submit" className="home-search-go" aria-label="Search">
        <SearchIcon size={16} />
        <span>Search</span>
      </button>

      {open && matches.length > 0 && (
        <ul className="home-search-list" id="home-search-list" role="listbox">
          <li className="home-search-list-head">{query ? 'Destinations' : 'Popular places to train'}</li>
          {matches.map((destination, i) => (
            <li key={destination.name} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(destination)}
              >
                <span className="home-search-pin" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z" />
                    <circle cx="12" cy="9.5" r="2.5" />
                  </svg>
                </span>
                <span>
                  <strong>{destination.name}</strong>
                  <small>{destination.hint}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/* ─── Rows ────────────────────────────────────────────────────────────── */

interface RowSpec {
  title: string;
  venues: Venue[];
  bounds?: { west: number; south: number; east: number; north: number };
}

const PLACEHOLDER_ROWS: RowSpec[] = [
  { title: 'Tallest climbs in Singapore', venues: [] },
  { title: 'Summits across Malaysia', venues: [] },
];

/** Photo first, then height: an empty grey tile in a row of photos reads as broken. */
function showcase(venues: Venue[], limit = 14): Venue[] {
  return [...venues]
    .sort((a, b) => Number(Boolean(b.photo)) - Number(Boolean(a.photo)) || rankingHeight(b) - rankingHeight(a))
    .slice(0, limit);
}

function buildRows(venues: Venue[]): RowSpec[] {
  const byRegion = new Map<string, Venue[]>();
  for (const venue of venues) {
    const region = regionOf(venue.lng, venue.lat) ?? 'Elsewhere';
    const bucket = byRegion.get(region);
    if (bucket) bucket.push(venue);
    else byRegion.set(region, [venue]);
  }
  const sg = byRegion.get('Singapore') ?? [];
  const rows: RowSpec[] = [
    { title: 'Tallest climbs in Singapore', venues: showcase(sg.filter((v) => v.type !== 'hdb_block' || v.notable)), bounds: DESTINATIONS[0].bounds },
    { title: 'HDB blocks for stair repeats', venues: showcase(sg.filter((v) => v.type === 'hdb_block' && v.photo)), bounds: DESTINATIONS[0].bounds },
    { title: 'Summits across Malaysia', venues: showcase(byRegion.get('Malaysia') ?? []), bounds: DESTINATIONS[5].bounds },
  ];
  for (const [region, list] of byRegion) {
    if (region === 'Singapore' || region === 'Malaysia' || list.length < 4) continue;
    const destination = DESTINATIONS.find((d) => d.name === region);
    rows.push({ title: `Peaks in ${region}`, venues: showcase(list), bounds: destination?.bounds });
  }
  return rows.filter((row) => row.venues.length > 0);
}

function Row({ title, action, loading, children }: { title: string; action: () => void; loading: boolean; children: React.ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = () => {
    const el = trackRef.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(update, [loading, children]);

  const page = (dir: number) => {
    const el = trackRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  return (
    <section className="home-row">
      <header className="home-row-head">
        <button type="button" className="home-row-title" onClick={action}>
          {title}
          <ChevronRightIcon size={14} />
        </button>
        <div className="home-row-nav">
          <button type="button" aria-label="Previous" disabled={edges.start} onClick={() => page(-1)}>
            <ChevronLeftIcon size={12} />
          </button>
          <button type="button" aria-label="Next" disabled={edges.end} onClick={() => page(1)}>
            <ChevronRightIcon size={12} />
          </button>
        </div>
      </header>
      <div className="home-row-track" ref={trackRef} onScroll={update}>
        {loading
          ? Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="tile skeleton-card" aria-hidden="true">
                <span className="sk-thumb" />
                <span className="sk-line" />
                <span className="sk-line" />
              </div>
            ))
          : children}
      </div>
    </section>
  );
}

function VenueTile({ venue, index }: { venue: Venue; index: number }) {
  const units = useUnits();
  const height = venueHeight(venue);
  const region = regionOf(venue.lng, venue.lat);
  return (
    <a className="tile" href={`#venue/${venue.slug}`} style={{ '--i': index } as React.CSSProperties}>
      <span className="tile-media">
        <VenueThumb venue={venue} />
        {venue.notable && <span className="tile-badge">Top climb</span>}
      </span>
      <span className="tile-top">
        <span className="tile-name">{venue.name}</span>
        <RatingLabel rating={venue.rating} />
      </span>
      <span className="tile-meta">
        {VENUE_TYPE_LABEL[venue.type]}
        {region ? ` in ${region}` : ''}
      </span>
      {height && (
        <span className="tile-meta">
          <strong>{units.height(height.value)}</strong> {height.kind === 'gain' ? 'to climb' : 'summit'}
        </span>
      )}
    </a>
  );
}

function RouteTile({ route, index }: { route: Route; index: number }) {
  const units = useUnits();
  const region = route.country ?? regionOf(route.coordinates[0][0], route.coordinates[0][1]);
  return (
    <button
      type="button"
      className="tile"
      style={{ '--i': index } as React.CSSProperties}
      onClick={() => {
        sessionStorage.setItem('hillgpx:pendingRoute', route.slug);
        openMap('routes', '#routes');
      }}
    >
      <span className="tile-media">
        <RouteThumb route={route} />
        <span className="tile-badge">{routeDifficulty(route)}</span>
      </span>
      <span className="tile-top">
        <span className="tile-name">{route.name}</span>
      </span>
      <span className="tile-meta">{[region, route.loop ? 'Loop' : 'Point to point'].filter(Boolean).join(' · ')}</span>
      <span className="tile-meta">
        <strong>{units.distance(route.distanceM)}</strong> · <strong>{units.height(route.gainM)}</strong> up
      </span>
    </button>
  );
}

function ContributeBanner() {
  return (
    <section className="home-contribute">
      <div className="home-contribute-copy">
        <h2>Know a climb that isn’t here?</h2>
        <p>
          Every place, photo, rating and route on hillGPX is a public contribution. Add the stairwell you repeat,
          the hill you race up, or the GPX from your last long run.
        </p>
        <div className="home-contribute-actions">
          <a className="btn btn-accent" href={addPlaceUrl()} target="_blank" rel="noreferrer">
            Add a place
          </a>
          <a className="btn btn-light" href={addRouteUrl()} target="_blank" rel="noreferrer">
            Share a route
          </a>
          <a className="btn btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
            <GitHubIcon size={16} /> GitHub
          </a>
        </div>
      </div>
      <div className="home-contribute-art" aria-hidden="true">
        <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice">
          <path d="M0 220 L70 120 L110 160 L180 60 L240 140 L290 95 L400 220Z" fill="#f3d9cf" />
          <path d="M0 220 L90 150 L150 190 L230 110 L300 170 L360 130 L400 160 L400 220Z" fill="#e8b7a4" />
          <path className="home-contribute-trail" d="M20 210 C 80 190, 110 150, 150 165 S 210 90, 240 120 S 300 150, 330 115 S 380 90, 395 80" fill="none" stroke="#c1502e" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 8" />
          <circle cx="180" cy="60" r="6" fill="#c1502e" />
        </svg>
      </div>
    </section>
  );
}

function HillArt() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <path d="M4 40 L18 18 L25 28 L31 20 L44 40Z" fill="#e8b7a4" />
      <path d="M18 18 L22 24 L18 23 L14 25Z" fill="#fff" />
      <path d="M4 40 L14 30 L20 36 L28 28 L44 40Z" fill="#c1502e" opacity="0.85" />
    </svg>
  );
}

function RouteArt() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <rect x="4" y="8" width="40" height="32" rx="6" fill="#f3e6df" />
      <path d="M11 33 C 18 30, 16 20, 24 21 S 32 14, 37 15" fill="none" stroke="#c1502e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="11" cy="33" r="3.5" fill="#fff" stroke="#222" strokeWidth="2" />
      <circle cx="37" cy="15" r="3" fill="#222" />
    </svg>
  );
}
