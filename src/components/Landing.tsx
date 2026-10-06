import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route, Venue } from '../types';
import { SiteSearch } from './SearchBar';
import { HEIGHT_LABEL, boundsOf, loadDataset, photoSrc, rankingHeight, townName, venueHeight, venueKindLabel, type Bounds, type Dataset } from '../lib/venues';
import { DESTINATIONS, boundsToHash, normalisePlace, regionBounds, regionOf } from '../lib/regions';
import { countrySummaries, type CountrySummary } from '../lib/worldPeaks';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { routeDifficulty, routeHasElevation } from '../lib/routes';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { RatingLabel } from './ResultsList';
import { RouteThumb } from './RouteThumb';
import { ActivityTag } from './ActivityIcon';
import { routeActivity } from '../lib/routeAnalysis';
import { VenueThumb } from './VenueThumb';
import { useUnits } from './UnitsContext';

type Mode = 'climbs' | 'routes';

function rememberMode(mode: Mode) {
  sessionStorage.setItem('hillgpx:mode', mode);
}

function openMap(mode: Mode, hash = '#map') {
  rememberMode(mode);
  window.location.hash = hash;
}

/** Where a row, its title and its "See all" card go: a real link, so it can be opened in a new tab too. */
interface MapLink {
  href: string;
  mode: Mode;
}

const climbsIn = (bounds: Bounds): MapLink => ({ href: boundsToHash(bounds), mode: 'climbs' });
const ROUTES_LINK: MapLink = { href: '#routes', mode: 'routes' };

/**
 * The front door, modelled on Airbnb's home: a header with the two things you
 * can browse, one search that takes you somewhere, and rows of real listings
 * underneath. No hero copy to read — the rows are the pitch.
 */
export function Landing() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadDataset().then(setDataset).catch((error: Error) => setLoadError(error.message));
  }, []);

  const countries = useCountries();
  const worldList = useMemo(() => worldRowCountries(countries), [countries]);
  // A country with its own "Highest peaks in …" row further down does not
  // also get a "Peaks in …" row from the local data: one row per country.
  const rows = useMemo(
    () => (dataset && countries ? buildRows(dataset.venues, new Set(worldList.map((c) => normalisePlace(c.name)))) : null),
    [dataset, countries, worldList],
  );
  const routes = useMemo(
    () => (dataset ? [...dataset.routes].sort((a, b) => b.gainM - a.gainM) : null),
    [dataset],
  );

  const placeRow = (row: RowSpec, half = false) => (
    <Row key={row.title} half={half} title={row.title} link={climbsIn(row.bounds)} loading={!rows} collage={collageOf(row.venues)}>
      {row.venues.map((venue, i) => <PlaceTile key={venue.slug} venue={venue} index={i} showKind={row.showKind} />)}
    </Row>
  );

  return (
    <div className="home">
      <SiteHeader sticky center={<SiteSearch />} />

      <HeroBlock />

      <main className="home-shell home-main">
        {loadError && (
          <section className="home-load-error" role="alert">
            <h2>Places and routes could not be loaded</h2>
            <p>{loadError}</p>
            <button type="button" className="btn btn-light" onClick={() => window.location.reload()}>Try again</button>
          </section>
        )}
        {!loadError && (
          <>
            <Row title="Routes worth running" link={ROUTES_LINK} loading={!routes}>
              {routes?.map((route, i) => <RouteTile key={route.slug} route={route} index={i} />)}
            </Row>
            {/* Singapore's two short rows read as one place: side by side, not two thin strips. */}
            <div className="home-row-pair">
              {(rows ?? PLACEHOLDER_ROWS).slice(0, 2).map((row) => placeRow(row, true))}
            </div>
            {(rows ?? PLACEHOLDER_ROWS).slice(2).map((row) => placeRow(row))}
            {countries && <WorldRows list={worldList} />}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

/* ─── Hero ─────────────────────────────────────────────────────────────── */

function HeroBlock() {
  return (
    <section className="home-hero">
      <h1 className="visually-hidden">hillGPX: hills, mountains and GPX routes worldwide</h1>
      <CountryMarquee mode="climbs" />
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
      onClick={() => openMap(mode, boundsToHash(country.bounds))}
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
/** Countries revealed per scroll step, and the most the page will show. */
const WORLD_BATCH = 4;
const WORLD_MAX = 24;
/** A row needs enough summits to scroll; tiny territories stay in the marquee and on the map. */
const WORLD_MIN_PEAKS = 6;

/** The countries that get a "Highest peaks in …" row, in page order. */
function worldRowCountries(countries: CountrySummary[] | null): CountrySummary[] {
  return (countries ?? []).filter((c) => !WORLD_SKIP.has(c.code) && c.peaks.length >= WORLD_MIN_PEAKS).slice(0, WORLD_MAX);
}

/**
 * More countries as you scroll, Airbnb-style: a skeleton row appears, then
 * the next countries' tallest summits fill in.
 */
function WorldRows({ list }: { list: CountrySummary[] }) {
  const [shown, setShown] = useState(WORLD_BATCH);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const done = shown >= list.length;

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

  return (
    <>
      {list.slice(0, shown).map((country) => (
        <Row
          key={country.code}
          title={`Highest peaks in ${country.name}`}
          link={climbsIn(country.bounds)}
          loading={false}
          collage={collageOf(country.peaks)}
        >
          {/* The title already says what and where, so the tiles carry just the name and height. */}
          {country.peaks.map((venue, i) => <PlaceTile key={venue.slug} venue={venue} index={i} />)}
        </Row>
      ))}
      {loading && <Row title="" link={null} loading>{null}</Row>}
      {!done && <div ref={sentinel} className="home-sentinel" aria-hidden="true" />}
    </>
  );
}

/* ─── Search ──────────────────────────────────────────────────────────── */

interface RowSpec {
  title: string;
  venues: Venue[];
  bounds: Bounds;
  /** Whether a tile should say what kind of place it is: only when the title does not. */
  showKind: boolean;
}

const SINGAPORE = DESTINATIONS[0].bounds;

const PLACEHOLDER_ROWS: RowSpec[] = [
  { title: 'Hills and summits in Singapore', venues: [], bounds: SINGAPORE, showKind: true },
  { title: 'Stair training in Singapore', venues: [], bounds: SINGAPORE, showKind: true },
  { title: 'Summits across Malaysia', venues: [], bounds: DESTINATIONS[5].bounds, showKind: false },
];

/** Photo first, then height: an empty grey tile in a row of photos reads as broken. */
function showcase(venues: Venue[], limit = 12): Venue[] {
  return venues
    // Some OSM summits are "named" with their height ("1762"); they read as a bug in a showcase row.
    .filter((venue) => !/^[\d\s.,m]+$/i.test(venue.name))
    .sort((a, b) => Number(Boolean(b.photo)) - Number(Boolean(a.photo)) || rankingHeight(b) - rankingHeight(a))
    .slice(0, limit);
}

function buildRows(venues: Venue[], worldRows: ReadonlySet<string>): RowSpec[] {
  const byRegion = new Map<string, Venue[]>();
  for (const venue of venues) {
    const region = regionOf(venue.lng, venue.lat);
    // Anything outside the coarse boxes is covered by the world rows below.
    if (!region) continue;
    const bucket = byRegion.get(region);
    if (bucket) bucket.push(venue);
    else byRegion.set(region, [venue]);
  }
  // "See all" frames every place the row stands for, not just the dozen shown.
  const boundsFor = (region: string, list: Venue[]): Bounds => boundsOf(list) ?? regionBounds(region) ?? SINGAPORE;
  const sg = byRegion.get('Singapore') ?? [];
  const malaysia = byRegion.get('Malaysia') ?? [];
  const rows: RowSpec[] = [
    { title: 'Hills and summits in Singapore', venues: showcase(sg.filter((v) => v.type === 'hill' || v.type === 'park')), bounds: SINGAPORE, showKind: true },
    { title: 'Stair training in Singapore', venues: showcase(sg.filter((v) => v.type === 'stairs' || v.type === 'hdb_block')), bounds: SINGAPORE, showKind: true },
    { title: 'Summits across Malaysia', venues: showcase(malaysia), bounds: boundsFor('Malaysia', malaysia), showKind: false },
  ];
  for (const [region, list] of byRegion) {
    if (region === 'Singapore' || region === 'Malaysia' || list.length < 4 || worldRows.has(normalisePlace(region))) continue;
    rows.push({ title: `Peaks in ${region}`, venues: showcase(list), bounds: boundsFor(region, list), showKind: false });
  }
  return rows.filter((row) => row.venues.length > 0);
}

/** Up to three of a row's photos for its "See all" card. */
function collageOf(venues: Venue[]): string[] {
  return venues.flatMap((venue) => (venue.photo?.file ? [photoSrc(venue.photo)] : [])).slice(0, 3);
}

function Row({ title, link, loading, children, half = false, collage = [] }: {
  title: string;
  link: MapLink | null;
  loading: boolean;
  children: React.ReactNode;
  half?: boolean;
  collage?: string[];
}) {
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
        {title === '' || !link ? <span className="sk-line sk-heading" aria-hidden="true" /> : (
          // Airbnb's pattern: the title is the link, a chevron says so.
          <h2 className="home-row-heading">
            <a className="home-row-title" href={link.href} onClick={() => rememberMode(link.mode)}>
              {title}
              <ChevronRightIcon size={14} />
            </a>
          </h2>
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
          : (
            <>
              {children}
              {link && title && <SeeAllTile link={link} title={title} photos={collage} />}
            </>
          )}
      </div>
    </section>
  );
}

/** The card at the end of a row: the same place as the title link, for people who scrolled to the end. */
function SeeAllTile({ link, title, photos }: { link: MapLink; title: string; photos: string[] }) {
  return (
    <a className="tile tile-see-all" href={link.href} onClick={() => rememberMode(link.mode)} aria-label={`See all: ${title}`}>
      <span className="tile-media">
        <span className="see-all-card">
          {photos.length > 0 ? (
            <span className={`see-all-stack n${photos.length}`} aria-hidden="true">
              {photos.map((src, i) => (
                <img key={src} src={src} alt="" loading="lazy" decoding="async" style={{ '--k': i } as React.CSSProperties} />
              ))}
            </span>
          ) : (
            <span className="see-all-arrow" aria-hidden="true"><ChevronRightIcon size={20} /></span>
          )}
          <span className="see-all-label">See all</span>
        </span>
      </span>
    </a>
  );
}

/** What a tile's middle line says, when it has something the row title does not. */
function tileMeta(venue: Venue, showKind: boolean): string | null {
  const parts: string[] = [];
  if (showKind) parts.push(venueKindLabel(venue));
  const town = townName(venue.town);
  if (town) parts.push(town);
  const routes = venue.routeSlugs.length;
  if (routes > 0) parts.push(`${routes} route${routes === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * One tile for every place on the landing — curated venues and world
 * summits alike: photo, name and rating, an optional fact line, the height.
 * Opens the place's page in a new tab so the row (and its scroll) stays put.
 */
function PlaceTile({ venue, index, showKind = false }: { venue: Venue; index: number; showKind?: boolean }) {
  const units = useUnits();
  const height = venueHeight(venue);
  const meta = tileMeta(venue, showKind);
  return (
    <a className="tile" href={`#venue/${venue.slug}`} target="_blank" rel="noopener" style={{ '--i': index } as React.CSSProperties}>
      <span className="tile-media">
        <VenueThumb venue={venue} />
      </span>
      <span className="tile-top">
        <span className="tile-name">{venue.name}</span>
        <RatingLabel rating={venue.rating} />
      </span>
      {meta && <span className="tile-meta">{meta}</span>}
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
