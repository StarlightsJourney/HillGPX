import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route, Venue } from '../types';
import {
  HEIGHT_LABEL,
  boundsOf,
  buildAreas,
  formatCount,
  matchAreas,
  rankingHeight,
  venueHeight,
  venueKindLabel,
  loadDataset,
  type Area,
  type Bounds,
} from '../lib/venues';
import { COUNTRY_ALIASES, DESTINATIONS, geocodePlace } from '../lib/regions';
import { routesBounds } from '../lib/routes';
import { fetchCommunityRoutes } from '../lib/api';
import { detectCountry } from '../lib/country';
import { openMapWith } from '../lib/mapIntent';
import { countrySummaries, notablePeakCountry, notablePeaks, peaksInView } from '../lib/worldPeaks';
import { normaliseQuery } from '../lib/streetTerms';
import { useUnits } from './UnitsContext';
import { LocateIcon, SearchIcon } from './icons';
import { SearchHint } from './SearchHint';
import { track } from '../lib/analytics';

interface SearchBarProps {
  /** Every loaded venue, whatever the filters and wherever the map is. */
  venues: Venue[];
  onPick: (slug: string) => void;
  /** Every route (committed, community, on this device), searched by name. */
  routes?: Route[];
  /** Open one route. Without it a route pick opens the map on that route. */
  onPickRoute?: (slug: string) => void;
  /**
   * Send the camera to a box rather than to a point — a whole country, a town,
   * or every match for a street name.
   */
  onFitBounds: (bounds: Bounds) => void;
  /** Pressing Search with nothing typed (pages without a map open it). Default: focus the box. */
  onEmptySubmit?: () => void;
  /** The locate button beside the pill. Default: open the map on routes near you. */
  onLocate?: () => void;
}

/**
 * Search on a page without the map: every pick opens the map, which shows
 * the routes there (or the climbs, when there are none).
 */
const openRouteOnMap = (slug: string) => openMapWith({ kind: 'route', slug });

export const SEARCH_OPENS_MAP: Pick<SearchBarProps, 'onPick' | 'onPickRoute' | 'onFitBounds'> = {
  onPick: (slug) => openMapWith({ kind: 'place', slug }),
  onPickRoute: openRouteOnMap,
  onFitBounds: (bounds) => openMapWith({ kind: 'area', bounds }),
};

const locateNearMe = () => openMapWith({ kind: 'near-me' });

/** Asks the header search to take the cursor and open its suggestions (the hero's "Search by Region"). */
export const SEARCH_FOCUS_EVENT = 'hillgpx:search';

/**
 * Puts the cursor in the header search. The event is dispatched (and the box
 * focused) synchronously, so calling this from a click handler still counts
 * as the tap that iOS needs before it opens the keyboard.
 */
export function focusSiteSearch(): void {
  window.dispatchEvent(new Event(SEARCH_FOCUS_EVENT));
}

/** A country or a curated destination: somewhere to go rather than something to climb. */
interface Place {
  key: string;
  name: string;
  meta: string;
  /** Null for a country whose summits straddle the antimeridian; looked up by name instead. */
  bounds: Bounds | null;
  /** Fallback box when the lookup fails: its tallest summits. */
  peaks: Venue[];
  /** Other names people type ("usa", "uk"), lower case. */
  aliases?: string[];
}

const MAX_RESULTS = 8;
const MAX_AREAS = 3;
const MAX_PLACES = 3;
const MAX_ROUTES = 3;

type Lookup = { state: 'idle' } | { state: 'searching'; query: string } | { state: 'missing'; query: string };

interface SgAreaFile {
  /** kind: 'area' (planning area), 'subzone' or 'alias'; b: [west, south, east, north]. */
  areas: { name: string; kind: string; in?: string; b: number[] }[];
}

/**
 * Singapore's planning areas, subzones and a few everyday names (Buona Vista,
 * Marina Bay), from URA Master Plan 2019 via scripts/build_sg_areas.py. Photon
 * answers these with a station or a building, and only on submit; here they
 * are suggested as you type and framed by their real extent.
 */
function neighbourhoodPlaces(file: SgAreaFile): Place[] {
  return file.areas.map((area) => ({
    key: `n:${area.name}`,
    name: area.name,
    meta: area.kind === 'area' ? 'Planning area · Singapore' : `Neighbourhood · ${area.in ?? 'Singapore'}`,
    bounds: { west: area.b[0], south: area.b[1], east: area.b[2], north: area.b[3] },
    peaks: [],
    // "one north" finds "one-north".
    aliases: area.name.includes('-') ? [fold(area.name.replace(/-/g, ' '))] : undefined,
  }));
}

/**
 * Countries, curated destinations and Singapore's neighbourhoods. Destinations
 * win a name clash (their boxes are hand-drawn), then countries.
 */
function usePlaces(): Place[] {
  const destinations = useMemo<Place[]>(
    () => DESTINATIONS.map((d) => ({ key: `d:${d.name}`, name: d.name, meta: d.hint, bounds: d.bounds, peaks: [] })),
    [],
  );
  const [countries, setCountries] = useState<Place[]>([]);
  const [neighbourhoods, setNeighbourhoods] = useState<Place[]>([]);
  useEffect(() => {
    let cancelled = false;
    void import('../lib/sgAreas.json')
      .then((module) => {
        if (!cancelled) setNeighbourhoods(neighbourhoodPlaces(module.default satisfies SgAreaFile));
      })
      .catch(() => undefined);
    void countrySummaries().then((summaries) => {
      if (cancelled) return;
      setCountries(
        summaries.map((c) => ({
          key: `c:${c.code}`,
          name: c.name,
          meta: `Country · ${formatCount(c.count)} summits`,
          bounds: c.bounds,
          peaks: c.peaks,
          aliases: COUNTRY_ALIASES[c.code],
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return useMemo(() => {
    const taken = new Set(destinations.map((d) => d.name.toLowerCase()));
    const kept = countries.filter((c) => !taken.has(c.name.toLowerCase()));
    for (const country of kept) taken.add(country.name.toLowerCase());
    return [...destinations, ...kept, ...neighbourhoods.filter((n) => !taken.has(n.name.toLowerCase()))];
  }, [destinations, countries, neighbourhoods]);
}

/**
 * The box, grown to include the three nearest climbs within 80 km when it has
 * none of its own. Checks the loaded venues first, then the world-summit
 * tiles around the place (they are only in memory where the map has been).
 */
async function withNearestClimbs(bounds: Bounds, loaded: Venue[]): Promise<Bounds> {
  const inside = (v: Venue) => v.lng >= bounds.west && v.lng <= bounds.east && v.lat >= bounds.south && v.lat <= bounds.north;
  if (loaded.some(inside)) return bounds;
  const lat = (bounds.south + bounds.north) / 2;
  const lng = (bounds.west + bounds.east) / 2;
  const reach = { west: lng - 0.9, south: lat - 0.75, east: lng + 0.9, north: lat + 0.75 };
  const summits = await peaksInView(reach).catch(() => []);
  const venues = [...loaded, ...summits];
  if (summits.some(inside)) return bounds;
  const km = (v: Venue) => 111.2 * Math.hypot(v.lat - lat, (v.lng - lng) * Math.cos((lat * Math.PI) / 180));
  const nearest = venues
    .map((venue) => ({ venue, distance: km(venue) }))
    .filter((hit) => hit.distance <= 80)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((hit) => hit.venue);
  if (nearest.length === 0) return bounds;
  const pad = 0.06;
  return {
    west: Math.min(bounds.west, ...nearest.map((v) => v.lng)) - pad,
    south: Math.min(bounds.south, ...nearest.map((v) => v.lat)) - pad,
    east: Math.max(bounds.east, ...nearest.map((v) => v.lng)) + pad,
    north: Math.max(bounds.north, ...nearest.map((v) => v.lat)) + pad,
  };
}

/** Lower case with accents removed, so "azumaya" finds "Azumaya San" and "zao" finds "Zaō". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** The world's best-known summits, loaded once for search. */
function useNotablePeaks(): Venue[] {
  const [peaks, setPeaks] = useState<Venue[]>([]);
  useEffect(() => {
    let cancelled = false;
    void notablePeaks().then((list) => {
      if (!cancelled) setPeaks(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return peaks;
}

/**
 * Routes whose name holds every word typed, in any order: exact name first,
 * then names starting with the query, then the rest. Routes have no place in
 * the geocoder, so a route's own title ("utown night walk") must be found here
 * or it is sent to Photon and lands on a street of the same name abroad.
 */
function matchRoutes(routes: Route[], q: string): { exact: Route | null; hits: Route[] } {
  if (q.length < 2) return { exact: null, hits: [] };
  const words = q.split(' ');
  let exact: Route | null = null;
  const prefix: Route[] = [];
  const rest: Route[] = [];
  for (const route of routes) {
    const name = fold(route.name).replace(/\s+/g, ' ').trim();
    if (name === q) exact ??= route;
    else if (name.startsWith(q)) prefix.push(route);
    else if (words.every((word) => name.includes(word))) rest.push(route);
  }
  return { exact, hits: [...(exact ? [exact] : []), ...prefix, ...rest] };
}

/** Exact name first, then names starting with the query, then anywhere in the name. */
function matchPlaces(places: Place[], q: string): { exact: Place | null; prefix: Place[]; inner: Place[] } {
  if (q.length < 2) return { exact: null, prefix: [], inner: [] };
  let exact: Place | null = null;
  const prefix: Place[] = [];
  const inner: Place[] = [];
  for (const place of places) {
    const names = [fold(place.name), ...(place.aliases ?? [])];
    if (names.includes(q)) exact ??= place;
    else if (names.some((name) => name.startsWith(q) || name.split(/[\s-]+/).some((word) => word.startsWith(q)))) prefix.push(place);
    else if (names.some((name) => name.includes(q))) inner.push(place);
  }
  return { exact, prefix, inner };
}

/**
 * Search.
 *
 * Venue matching runs over every loaded venue on every keystroke — not just the
 * ones on screen. Searching only what was in view meant a country or a hill
 * somewhere else could never be found, and pressing Search left the camera
 * where it was. At ~18k venues a lowercase substring scan is a few
 * milliseconds, so there is no index and no debounce.
 */
export function SearchBar({ venues, routes = [], onPick, onPickRoute = openRouteOnMap, onFitBounds, onEmptySubmit, onLocate = locateNearMe }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const lookupIdRef = useRef(0);
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const units = useUnits();
  const places = usePlaces();
  const notable = useNotablePeaks();
  // What is loaded (on screen) plus the world's best-known summits, so a
  // summit on another continent is found too.
  const pool = useMemo(() => {
    if (notable.length === 0) return venues;
    const loaded = new Set(venues.map((v) => v.slug));
    return [...venues, ...notable.filter((v) => !loaded.has(v.slug))];
  }, [venues, notable]);
  const loadedSlugs = useMemo(() => new Set(venues.map((v) => v.slug)), [venues]);

  // Lowercase, accent-free names once, not once per keystroke.
  const haystack = useMemo(() => pool.map((v) => fold(`${v.name} ${v.town ?? ''}`)), [pool]);
  const areas = useMemo(() => buildAreas(venues), [venues]);
  const normalised = useMemo(() => fold(normaliseQuery(query)), [query]);
  // Place names are matched on the plain query: street expansions would turn
  // "st" into "street" and miss "St Lucia".
  const plain = fold(query).trim().replace(/\s+/g, ' ');

  // Every match, not just the ones that fit on screen. Truncating during the
  // scan would return the first eight blocks in file order and sort only those,
  // so searching a long street would hide its tallest blocks — which is the one
  // thing this app exists to surface.
  const matches = useMemo(() => {
    // "ang mo kio ave 10" has to find "Ang Mo Kio Avenue 10", which is how the
    // ingest stores it.
    if (normalised.length < 2) return [];
    const found: Venue[] = [];
    for (let i = 0; i < haystack.length; i++) {
      if (haystack[i].includes(normalised)) found.push(pool[i]);
    }
    return found.sort((a, b) => rankingHeight(b) - rankingHeight(a));
  }, [normalised, haystack, pool]);

  const results = useMemo(() => matches.slice(0, MAX_RESULTS), [matches]);
  // A town of blocks named like a place ("Queenstown") gives way to it: the
  // place has the real boundary, the town only the box round its blocks.
  const placeNames = useMemo(() => new Set(places.map((place) => fold(place.name))), [places]);
  const areaHits = useMemo(
    () => matchAreas(areas.filter((area) => !placeNames.has(fold(area.name))), normalised, MAX_AREAS),
    [areas, placeNames, normalised],
  );
  const placeHits = useMemo(() => matchPlaces(places, plain), [places, plain]);
  const routeHits = useMemo(() => matchRoutes(routes, plain), [routes, plain]);
  const routeRows = useMemo(() => routeHits.hits.slice(0, MAX_ROUTES), [routeHits]);
  const placeRows = useMemo(
    () => [...(placeHits.exact ? [placeHits.exact] : []), ...placeHits.prefix, ...placeHits.inner].slice(0, MAX_PLACES),
    [placeHits],
  );

  // Places offered before anything is typed.
  const suggestions = useMemo(() => places.filter((place) => place.key.startsWith('d:')), [places]);

  // focusSiteSearch(): the page has already scrolled (or is scrolling) to the
  // header, so focusing must not jump it again.
  useEffect(() => {
    const onRequest = () => {
      inputRef.current?.focus({ preventScroll: true });
      setOpen(true);
    };
    window.addEventListener(SEARCH_FOCUS_EVENT, onRequest);
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, onRequest);
  }, []);

  // Close the dropdown when clicking anywhere else.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const reset = () => {
    lookupIdRef.current += 1;
    setLookup({ state: 'idle' });
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const pick = (slug: string) => {
    const venue = pool.find((v) => v.slug === slug);
    // A summit from the world list is not loaded yet: frame it, and the map
    // loads its area and shows its pin.
    if (venue && !loadedSlugs.has(slug)) onFitBounds({ west: venue.lng - 0.06, south: venue.lat - 0.06, east: venue.lng + 0.06, north: venue.lat + 0.06 });
    else onPick(slug);
    reset();
  };

  const pickRoute = (slug: string) => {
    onPickRoute(slug);
    reset();
  };

  /** One route opens; several are framed together. */
  const pickRoutes = (found: Route[]) => {
    const bounds = found.length > 1 ? routesBounds(found) : null;
    if (bounds) {
      onFitBounds(bounds);
      reset();
    } else pickRoute(found[0].slug);
  };

  const pickArea = (area: Area) => {
    onFitBounds(area.bounds);
    reset();
  };

  /**
   * Ask the geocoder, and say so when it finds nothing. The camera only moves
   * on an answer — never to some default, and never to the person's location.
   */
  const geocode = (text: string, fallback: Bounds | null = null) => {
    const id = ++lookupIdRef.current;
    setLookup({ state: 'searching', query: text });
    setOpen(true);
    void detectCountry()
      .catch(() => null)
      .then((country) => geocodePlace(text, undefined, country))
      .catch(() => null)
      // A town with no climbs inside its box (Perth's centre) is widened to
      // take in the nearest ones, so the search lands somewhere useful.
      .then((bounds) => (bounds ? withNearestClimbs(bounds, pool) : null))
      .then((bounds) => {
        if (id !== lookupIdRef.current) return;
        const target = bounds ?? fallback;
        if (target) {
          onFitBounds(target);
          reset();
        } else {
          setLookup({ state: 'missing', query: text });
        }
      });
  };

  const pickPlace = (place: Place) => {
    if (place.bounds) {
      onFitBounds(place.bounds);
      reset();
      return;
    }
    // A country across the antimeridian has no single box in the index; the
    // geocoder has one, and its tallest summits are the fallback.
    geocode(place.name, boundsOf(place.peaks));
  };

  /**
   * Enter, from a search box, means "take me there" — the habit every map
   * application has trained. In order: a place whose name is exactly what was
   * typed ("japan"), a route with exactly that name, a town, a place whose
   * name starts with it, a single venue, the routes whose names match (one is
   * opened, several framed), the venues (framed together), then a place merely
   * containing it, and finally the geocoder for anything else ("kyoto").
   */
  const submit = () => {
    if (!query.trim()) {
      if (onEmptySubmit) onEmptySubmit();
      else inputRef.current?.focus();
      return;
    }
    track('search', query.trim());
    if (placeHits.exact) return pickPlace(placeHits.exact);
    if (routeHits.exact) return pickRoute(routeHits.exact.slug);
    if (areaHits.length > 0) return pickArea(areaHits[0]);
    if (placeHits.prefix.length > 0) return pickPlace(placeHits.prefix[0]);
    if (matches.length === 1) return pick(matches[0].slug);
    if (routeHits.hits.length > 0) return pickRoutes(routeHits.hits);
    const bounds = boundsOf(matches);
    if (bounds) {
      onFitBounds(bounds);
      setOpen(false);
      return;
    }
    if (placeHits.inner.length > 0) return pickPlace(placeHits.inner[0]);
    geocode(query.trim());
  };

  const hasLocal = routeRows.length > 0 || areaHits.length > 0 || results.length > 0 || placeRows.length > 0;
  const suggesting = query.trim() === '' && lookup.state === 'idle' && suggestions.length > 0;
  const status =
    lookup.state === 'searching' ? (
      <p className="small muted results-head" role="status">Looking up “{lookup.query}”…</p>
    ) : lookup.state === 'missing' ? (
      <p className="small muted results-head" role="status">
        Could not find “{lookup.query}”. Try a hill, a town or a country.
      </p>
    ) : normalised.length >= 2 && !hasLocal ? (
      <p className="small muted results-head">Press Search to look up “{query.trim()}” on the map.</p>
    ) : null;

  // The same pill as the landing page's search, so the header keeps one shape
  // and one position on every page and at every width. The locate button sits
  // just left of it (inside its left end on phones).
  return (
    <div className="header-search">
      <button type="button" className="locate-btn" onClick={onLocate} aria-label="Show routes near me" data-tip="Routes near me">
        <LocateIcon size={18} />
      </button>
      <form
        ref={rootRef}
        className={`home-search map-search${open ? ' focused' : ''}`}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="home-search-field home-search-where">
          <input
            ref={inputRef}
            type="search"
            value={query}
            aria-label="Search countries, hills, routes, blocks and streets"
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              lookupIdRef.current += 1;
              setLookup({ state: 'idle' });
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') reset();
            }}
          />
          <SearchHint hidden={query.length > 0} />
        </label>
        <button type="submit" className="home-search-go" aria-label="Search">
          <SearchIcon size={16} />
          <span>Search</span>
        </button>
        {open && (status !== null || hasLocal || suggesting) && (
          <div className="searchbar-results">
            {status}
            {suggesting && <p className="small muted results-head">Popular regions</p>}
            {suggesting &&
              suggestions.map((place) => (
                <button type="button" key={place.key} className="result-row area-row" onClick={() => pickPlace(place)}>
                  <span className="result-name">{place.name}</span>
                  <span className="result-meta small muted">{place.meta}</span>
                </button>
              ))}
            {placeRows.map((place) => (
              <button type="button" key={place.key} className="result-row area-row" onClick={() => pickPlace(place)}>
                <span className="result-name">{place.name}</span>
                <span className="result-meta small muted">{place.meta}</span>
              </button>
            ))}
            {routeRows.map((route) => (
              <button type="button" key={`r:${route.slug}`} className="result-row" onClick={() => pickRoute(route.slug)}>
                <span className="result-name">{route.name}</span>
                <span className="result-meta small muted">
                  Route · {units.distance(route.distanceM)}
                  {route.elevationAvailable !== false && ` · ${units.height(route.gainM)} ${HEIGHT_LABEL.gain}`}
                </span>
              </button>
            ))}
            {areaHits.map((area) => (
              <button type="button" key={area.code} className="result-row area-row" onClick={() => pickArea(area)}>
                <span className="result-name">{area.name}</span>
                <span className="result-meta small muted">Area · {area.venueCount} places mapped</span>
              </button>
            ))}
            {results.map((venue) => {
              const height = venueHeight(venue);
              return (
                <button type="button" key={venue.slug} className="result-row" onClick={() => pick(venue.slug)}>
                  <span className="result-name">{venue.name}</span>
                  <span className="result-meta small muted">
                    {venueKindLabel(venue)}
                    {height && ` · ${units.height(height.value)} ${HEIGHT_LABEL[height.kind]}`}
                    {notablePeakCountry(venue.slug) && ` · ${notablePeakCountry(venue.slug)}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </form>
    </div>
  );
}

/**
 * The header search on pages without a map (landing, info, training): the
 * same SearchBar as the map page, over the same data, so a search finds the
 * same things everywhere. Every pick opens the map on that place's routes
 * (its climbs when it has none).
 */
export function SiteSearch() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadDataset()
      .then((dataset) => {
        if (cancelled) return;
        setVenues(dataset.venues);
        setRoutes((current) => [...dataset.routes, ...current]);
      })
      .catch(() => undefined);
    fetchCommunityRoutes()
      .then((community) => {
        if (!cancelled) setRoutes((current) => [...current, ...community]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <SearchBar venues={venues} routes={routes} {...SEARCH_OPENS_MAP} onEmptySubmit={() => (window.location.hash = '#map')} />
  );
}
