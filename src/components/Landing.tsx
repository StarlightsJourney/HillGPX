import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route, Venue } from '../types';
import { HEIGHT_LABEL, loadDataset, rankingHeight, venueHeight, type Dataset, venueKindLabel } from '../lib/venues';
import { DESTINATIONS, boundsToHash, regionOf, type Destination } from '../lib/regions';
import { countrySummaries, loadPeakPhotos, type CountrySummary, type PeakPhoto } from '../lib/worldPeaks';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { routeDifficulty, routeHasElevation } from '../lib/routes';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from './icons';
import { RatingLabel } from './ResultsList';
import { RouteThumb } from './RouteThumb';
import { ActivityTag } from './ActivityIcon';
import { routeActivity } from '../lib/routeAnalysis';
import { PlaceArt, VenueThumb } from './VenueThumb';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  // Switching Climbs and Routes shows a brief loading state instead of the
  // rows vanishing and reappearing in one frame.
  const [switching, setSwitching] = useState(false);
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setSwitching(true);
  };
  useEffect(() => {
    if (!switching) return;
    const timer = window.setTimeout(() => setSwitching(false), 450);
    return () => window.clearTimeout(timer);
  }, [switching]);

  useEffect(() => {
    loadDataset().then(setDataset).catch((error: Error) => setLoadError(error.message));
  }, []);

  const rows = useMemo(() => (dataset ? buildRows(dataset.venues) : null), [dataset]);
  const routes = useMemo(
    () => (dataset ? [...dataset.routes].sort((a, b) => b.gainM - a.gainM) : null),
    [dataset],
  );

  return (
    <div className="home">
      <SiteHeader sticky center={<HomeSearch mode={mode} onModeChange={switchMode} onOpen={onOpen} />} />

      <HeroBlock mode={mode} />

      <main className="home-shell home-main">
        {loadError && (
          <section className="home-load-error" role="alert">
            <h2>Places and routes could not be loaded</h2>
            <p>{loadError}</p>
            <button type="button" className="btn btn-light" onClick={() => window.location.reload()}>Try again</button>
          </section>
        )}
        {!loadError && switching && (
          <>
            <Row title="" action={() => undefined} loading>{null}</Row>
            <Row title="" action={() => undefined} loading>{null}</Row>
          </>
        )}
        {!loadError && !switching && (mode === 'routes' ? (
          <>
            <Row title="Routes worth running" action={() => openMap('routes', '#routes')} loading={!routes}>
              {routes?.map((route, i) => <RouteTile key={route.slug} route={route} index={i} />)}
            </Row>
          </>
        ) : (
          <>
            {routes && routes.length > 0 && (
              <Row title="Routes worth running" action={() => openMap('routes', '#routes')} loading={false}>
                {routes.map((route, i) => <RouteTile key={route.slug} route={route} index={i} />)}
              </Row>
            )}
            {/* Singapore's two short rows read as one place: side by side, not two thin strips. */}
            <div className="home-row-pair">
              {(rows ?? PLACEHOLDER_ROWS).slice(0, 2).map((row) => (
                <Row
                  key={row.title}
                  half
                  title={row.title}
                  action={row.bounds ? () => openMap('climbs', boundsToHash(row.bounds!)) : onOpen}
                  loading={!rows}
                >
                  {row.venues.map((venue, i) => <VenueTile key={venue.slug} venue={venue} index={i} />)}
                </Row>
              ))}
            </div>
            {(rows ?? PLACEHOLDER_ROWS).slice(2).map((row) => (
              <Row
                key={row.title}
                title={row.title}
                action={row.bounds ? () => openMap('climbs', boundsToHash(row.bounds!)) : onOpen}
                loading={!rows}
              >
                {row.venues.map((venue, i) => <VenueTile key={venue.slug} venue={venue} index={i} />)}
              </Row>
            ))}
            <WorldRows />
          </>
        ))}
      </main>

      <SiteFooter />
    </div>
  );
}

/* ─── Hero ─────────────────────────────────────────────────────────────── */

function HeroBlock({ mode }: { mode: Mode }) {
  return (
    <section className="home-hero">
      <h1 className="visually-hidden">hillGPX: hills, mountains and GPX routes worldwide</h1>
      <CountryMarquee mode={mode} />
    </section>
  );
}

function useCountries(): CountrySummary[] | null {
  const [countries, setCountries] = useState<CountrySummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void countrySummaries().then((list) => {
      if (!cancelled) setCountries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return countries;
}

/** Every country on the map, drifting past; hover pauses it, a tap opens that country. */
function CountryMarquee({ mode }: { mode: Mode }) {
  const countries = useCountries();
  if (!countries || countries.length === 0) return <div className="marquee loading" aria-hidden="true" />;
  const list = countries.slice(0, 60);
  const chip = (country: CountrySummary, copy: number) => (
    <button
      key={`${country.code}-${copy}`}
      type="button"
      className="marquee-chip"
      tabIndex={copy ? -1 : 0}
      aria-hidden={copy ? true : undefined}
      onClick={() => openMap(mode, country.bounds ? boundsToHash(country.bounds) : '#map')}
    >
      <span>{country.name}</span>
      <small>{country.count.toLocaleString()}</small>
    </button>
  );
  return (
    <nav className="marquee" aria-label="Countries with mapped summits">
      <div className="marquee-track" style={{ '--n': list.length } as React.CSSProperties}>
        {list.map((country) => chip(country, 0))}
        {list.map((country) => chip(country, 1))}
      </div>
    </nav>
  );
}

const WORLD_SKIP = new Set(['SG', 'MY', 'TW', 'HK']);
const WORLD_BATCH = 4;

/**
 * More countries as you scroll, Airbnb-style: a skeleton row appears, then
 * the next countries' tallest summits fill in.
 */
function WorldRows() {
  const countries = useCountries();
  const [photos, setPhotos] = useState<Map<string, PeakPhoto> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadPeakPhotos().then((map) => {
      if (!cancelled) setPhotos(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [shown, setShown] = useState(WORLD_BATCH);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const list = useMemo(() => (countries ?? []).filter((c) => !WORLD_SKIP.has(c.code) && c.peaks.length >= 4), [countries]);
  const done = shown >= Math.min(list.length, 24);

  // Seeing the sentinel starts a short skeleton; the timer below then reveals
  // the next batch. Kept as two effects so starting the skeleton does not
  // cancel its own timer.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || loading) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setLoading(true);
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [done, loading, list.length]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => {
      setShown((n) => n + WORLD_BATCH);
      setLoading(false);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (!countries) return null;
  return (
    <>
      {list.slice(0, shown).map((country) => (
        <Row
          key={country.code}
          title={`Highest peaks in ${country.name}`}
          action={() => openMap('climbs', country.bounds ? boundsToHash(country.bounds) : '#map')}
          loading={false}
        >
          {country.peaks.map((venue, i) => <PeakTile key={venue.slug} venue={venue} country={country.name} index={i} photo={photos?.get(venue.slug)} />)}
        </Row>
      ))}
      {loading && <Row title="" action={() => undefined} loading>{null}</Row>}
      {!done && <div ref={sentinel} className="home-sentinel" aria-hidden="true" />}
    </>
  );
}

/** A landing summit: its Commons/Wikipedia photo when one exists, the shared drawn placeholder otherwise. */
function PeakTile({ venue, country, index, photo }: { venue: Venue; country: string; index: number; photo?: PeakPhoto }) {
  const units = useUnits();
  const [failed, setFailed] = useState(false);
  return (
    <a className="tile" href={`#venue/${venue.slug}`} style={{ '--i': index } as React.CSSProperties}>
      <span className="tile-media">
        {photo && !failed ? (
          <span className="card-thumb loading-shimmer"><img src={photo.url} alt={venue.name} loading="lazy" decoding="async" onError={() => setFailed(true)} /></span>
        ) : (
          <span className="card-thumb placeholder"><PlaceArt venue={venue} /></span>
        )}
        <span className="tile-badge">{units.height(venue.summitM ?? 0)}</span>
      </span>
      <span className="tile-top">
        <span className="tile-name">{venue.name}</span>
      </span>
      <span className="tile-meta">{venueKindLabel(venue)} in {country}</span>
    </a>
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
  { title: 'Hills and summits in Singapore', venues: [] },
  { title: 'Stair training in Singapore', venues: [] },
  { title: 'Summits across Malaysia', venues: [] },
];

/** Photo first, then height: an empty grey tile in a row of photos reads as broken. */
function showcase(venues: Venue[], limit = 12): Venue[] {
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
    { title: 'Hills and summits in Singapore', venues: showcase(sg.filter((v) => v.type === 'hill' || v.type === 'park')), bounds: DESTINATIONS[0].bounds },
    { title: 'Stair training in Singapore', venues: showcase(sg.filter((v) => v.type === 'stairs' || v.type === 'hdb_block')), bounds: DESTINATIONS[0].bounds },
    { title: 'Summits across Malaysia', venues: showcase(byRegion.get('Malaysia') ?? []), bounds: DESTINATIONS[5].bounds },
  ];
  for (const [region, list] of byRegion) {
    if (region === 'Singapore' || region === 'Malaysia' || list.length < 4) continue;
    const destination = DESTINATIONS.find((d) => d.name === region);
    rows.push({ title: `Peaks in ${region}`, venues: showcase(list), bounds: destination?.bounds });
  }
  return rows.filter((row) => row.venues.length > 0);
}

function Row({ title, action, loading, children, half = false }: { title: string; action: () => void; loading: boolean; children: React.ReactNode; half?: boolean }) {
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
    <section className={`home-row${half ? ' half' : ''}`}>
      <header className="home-row-head">
        {title === '' ? <span className="sk-line sk-heading" aria-hidden="true" /> : (
        <button type="button" className="home-row-title" onClick={action}>
          {title}
          <span className="home-row-see-all">See all</span>
          <ChevronRightIcon size={14} />
        </button>
        )}
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
      </span>
      <span className="tile-top">
        <span className="tile-name">{venue.name}</span>
        <RatingLabel rating={venue.rating} />
      </span>
      <span className="tile-meta">
        {venueKindLabel(venue)}
        {region ? ` in ${region}` : ''}
      </span>
      {height && (
        <span className="tile-meta">
          <strong>{units.height(height.value)}</strong> {HEIGHT_LABEL[height.kind]}
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
        <ActivityTag activity={routeActivity(route)} />
      </span>
      <span className="tile-meta">{[region, route.loop ? 'Loop' : 'Point to point'].filter(Boolean).join(' · ')}</span>
      <span className="tile-meta">
        <strong>{units.distance(route.distanceM)}</strong> · <strong>{routeHasElevation(route) ? `${units.height(route.gainM)} EG` : 'Elevation unavailable'}</strong>
      </span>
    </button>
  );
}

