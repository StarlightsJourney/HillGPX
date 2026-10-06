import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landing } from './components/Landing';
import { ResultsList } from './components/ResultsList';
import { GpxDropzone, type LoadedGpx } from './components/GpxDropzone';
import { GpxPanel } from './components/GpxPanel';
import { SearchBar } from './components/SearchBar';
import { FilterBar, type BrowseMode } from './components/FilterBar';
import { VenueDetail, VenueDetailSkeleton } from './components/VenueDetail';
import { RoutesList } from './components/RoutesList';
import { RoutePanel } from './components/RoutePanel';
import { NO_ROUTE_FILTERS, filterRoutes, routeBounds, type RouteFilters } from './lib/routes';
import { boundsFromHash } from './lib/regions';
import { ElevationModel } from './lib/elevation';
import {
  NO_FILTERS,
  boundsOf,
  filterVenues,
  loadDataset,
  loadFavorites,
  saveFavorites,
  nearest,
  presentVenueTypes,
  routesForVenue,
  tallestWithin,
  venuesInBounds,
  type Bounds,
  type Dataset,
  type VenueFilters,
} from './lib/venues';
import { haversineM } from './lib/elevation';
import type { Route, RoutePoint, Venue } from './types';
import { CloseIcon, ListIcon, LocationArrowIcon, MapIcon } from './components/icons';
import { loadLocalRoutes, saveLocalRoutes } from './lib/localRoutes';
import { logSession } from './lib/training';
import { TrainingPanel } from './components/TrainingPanel';
import { InfoPage, type InfoPageId } from './components/InfoPage';
import { UnitsProvider } from './components/UnitsContext';
import { Modal } from './components/Modal';
import { SiteFooter, SiteHeader } from './components/SiteChrome';
import { OpenSourceBadge, OpenSourceNotice } from './components/OpenSourceNotice';
import { fetchCommunityRoutes, fetchRoutePhotos, type RoutePhoto } from './lib/api';
import { findOverlaps } from './lib/routeAnalysis';
import { IMPORT_EVENT, REPORT_EVENT, type ReportRequest } from './lib/contribute';
import { ReportModal } from './components/ReportModal';
import { track } from './lib/analytics';
import { isWorldPeakSlug, peaksInView, worldPeakBySlug } from './lib/worldPeaks';

/** One shared empty list, so "no dataset yet" is a stable reference to memo on. */
const NO_VENUES: Venue[] = [];
const NO_PHOTOS: RoutePhoto[] = [];

// MapLibre is by far the largest dependency here. Code-splitting it keeps the
// landing page down to a small bundle that paints immediately; the map is only
// fetched once someone actually opens it.
const MapView = lazy(() => import('./map/MapView').then((m) => ({ default: m.MapView })));

type View = 'landing' | 'map' | 'training' | InfoPageId;

const INFO_PAGES: ReadonlySet<string> = new Set<InfoPageId>(['privacy', 'terms', 'contact']);

function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash === '#map' || hash === '#routes' || hash === '#import' || hash.startsWith('#map/') || hash.startsWith('#venue/')) return 'map';
  if (hash === '#training') return 'training';
  if (INFO_PAGES.has(hash.slice(1))) return hash.slice(1) as InfoPageId;
  return 'landing';
}

function detailSlugFromHash(): string | null {
  return window.location.hash.startsWith('#venue/')
    ? window.location.hash.slice('#venue/'.length)
    : null;
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  // "Report" on a photo or review anywhere (map popups dispatch requestReport).
  const [report, setReport] = useState<ReportRequest | null>(null);
  useEffect(() => {
    const open = (event: Event) => setReport((event as CustomEvent<ReportRequest>).detail);
    window.addEventListener(REPORT_EVENT, open);
    return () => window.removeEventListener(REPORT_EVENT, open);
  }, []);

  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  // The provider wraps both views, not just the map: the landing page prints a
  // height too, and someone who has chosen feet should not be shown metres on
  // the way back in.
  return (
    <UnitsProvider>
      {view === 'landing' ? (
        <Landing onOpen={() => (window.location.hash = '#map')} />
      ) : view === 'training' ? (
        <TrainingPanel onClose={() => (window.location.hash = '#map')} />
      ) : view !== 'map' ? (
        <InfoPage page={view} />
      ) : (
        <MapApp />
      )}
      {view === 'landing' && <OpenSourceNotice />}
      {report && <ReportModal targetType={report.targetType} targetSlug={report.targetSlug} targetName={report.targetName} onClose={() => setReport(null)} />}
      {view !== 'map' && <OpenSourceBadge placement={view === 'landing' ? 'landing' : 'corner'} />}
    </UnitsProvider>
  );
}

function ListSkeleton() {
  return (
    <section className="results" aria-busy="true">
      <div className="sk-line sk-heading" />
      <ul className="results-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="skeleton-card" aria-hidden="true">
            <span className="sk-thumb" />
            <span className="sk-line" />
            <span className="sk-line" />
            <span className="sk-line" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Whether a viewport change is large enough to be worth recomputing the list
 * for. A tenth of the current span in any direction is well below what would
 * visibly reorder forty results.
 */
function boundsChangedMeaningfully(
  prev: { west: number; south: number; east: number; north: number } | null,
  next: { west: number; south: number; east: number; north: number },
): boolean {
  if (!prev) return true;
  const tolX = Math.abs(next.east - next.west) * 0.1;
  const tolY = Math.abs(next.north - next.south) * 0.1;
  return (
    Math.abs(prev.west - next.west) > tolX ||
    Math.abs(prev.east - next.east) > tolX ||
    Math.abs(prev.north - next.north) > tolY ||
    Math.abs(prev.south - next.south) > tolY
  );
}

function MapApp() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [elevationModel, setElevationModel] = useState<ElevationModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeRouteSlug, setActiveRouteSlug] = useState<string | null>(null);
  const [detailSlug, setDetailSlug] = useState(detailSlugFromHash);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [localRoutes, setLocalRoutes] = useState<Route[]>(loadLocalRoutes);
  const [droppedGpx, setDroppedGpx] = useState<LoadedGpx | null>(null);
  const [gpxHoverIndex, setGpxHoverIndex] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
  const [focusBounds, setFocusBounds] = useState<{ bounds: Bounds; nonce: number } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [locateHint, setLocateHint] = useState<string | null>(null);
  // Wide screens only: the map takes the whole width, chosen with the expand
  // control. Opening a route keeps the list beside the map; the control
  // pulses while a route is open so the bigger view is easy to find.
  const [mapExpanded, setMapExpanded] = useState(false);
  // Where the list was scrolled before the expanded map folded it away.
  const listScrollRef = useRef(0);
  // Small screens switch between full list and full map; wide screens show both.
  const [listOpen, setListOpen] = useState(true);
  const [gpxOpen, setGpxOpen] = useState(() => window.location.hash === '#import');
  const [communityRoutes, setCommunityRoutes] = useState<Route[]>([]);
  const [publishedRoute, setPublishedRoute] = useState<Route | null>(null);
  const [worldPeaks, setWorldPeaks] = useState<Venue[]>(NO_VENUES);
  // A summit opened by link or favourite whose tile is not on screen.
  const [linkedPeak, setLinkedPeak] = useState<Venue | null>(null);
  const [filters, setFilters] = useState<VenueFilters>(NO_FILTERS);
  const [mode, setMode] = useState<BrowseMode>(() =>
    window.location.hash === '#routes' || sessionStorage.getItem('hillgpx:mode') === 'routes' ? 'routes' : 'climbs',
  );
  const [routeFilters, setRouteFilters] = useState<RouteFilters>(NO_ROUTE_FILTERS);
  const [selectedRouteSlug, setSelectedRouteSlug] = useState<string | null>(null);
  const [hoveredRouteSlug, setHoveredRouteSlug] = useState<string | null>(null);
  const [routeHoverIndex, setRouteHoverIndex] = useState<number | null>(null);
  // A venue picked from a route's "Passes" list: pinned on the map beside the
  // route rather than opening its detail page over it.
  const [spotlight, setSpotlight] = useState<{ slug: string; nonce: number } | null>(null);
  const [viewport, setViewport] = useState<
    { west: number; south: number; east: number; north: number } | null
  >(null);

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((err: Error) => setLoadError(err.message));

    // A few megabytes, and only the GPX profile needs it, so the map stays
    // fully usable while it loads — or if it never does.
    ElevationModel.load()
      .then(setElevationModel)
      .catch((err: Error) => console.warn('Terrain model unavailable:', err.message));

    // Community routes are an addition to the committed ones; the map works without them.
    fetchCommunityRoutes()
      .then(setCommunityRoutes)
      .catch((err: Error) => console.warn('Community routes unavailable:', err.message));

    if (window.location.hash === '#import') history.replaceState(null, '', '#map');
  }, []);

  // "Add a GPX" on a venue page opens the dialog over that page (openImportHere).
  useEffect(() => {
    const open = () => setGpxOpen(true);
    window.addEventListener(IMPORT_EVENT, open);
    return () => window.removeEventListener(IMPORT_EVENT, open);
  }, []);

  useEffect(() => {
    const onHash = () => {
      // The footer's "Routes" link while the map is already open.
      if (window.location.hash === '#routes') {
        setMode('routes');
        setSelectedSlug(null);
        return;
      }
      if (window.location.hash !== '#import') return;
      setGpxOpen(true);
      history.replaceState(null, '', '#map');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Worldwide summits for whatever is on screen: whole 5° tiles when zoomed in,
  // each tile's tallest few when zoomed out.
  useEffect(() => {
    if (!viewport) return;
    let cancelled = false;
    void peaksInView(viewport).then((peaks) => {
      if (!cancelled) setWorldPeaks(peaks.length ? peaks : NO_VENUES);
    });
    return () => {
      cancelled = true;
    };
  }, [viewport]);

  useEffect(() => {
    if (!detailSlug || !isWorldPeakSlug(detailSlug)) return;
    let cancelled = false;
    void worldPeakBySlug(detailSlug).then((peak) => {
      if (!cancelled) setLinkedPeak(peak);
    });
    return () => {
      cancelled = true;
    };
  }, [detailSlug]);

  useEffect(() => {
    const syncDetail = () => setDetailSlug(detailSlugFromHash());
    window.addEventListener('hashchange', syncDetail);
    return () => window.removeEventListener('hashchange', syncDetail);
  }, []);

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  useEffect(() => {
    sessionStorage.setItem('hillgpx:mode', mode);
  }, [mode]);

  // Hearted world summits are kept loaded so "Saved" shows them wherever the map is.
  const [savedPeaks, setSavedPeaks] = useState<Venue[]>(NO_VENUES);
  useEffect(() => {
    const slugs = [...favorites].filter(isWorldPeakSlug);
    if (slugs.length === 0) {
      setSavedPeaks(NO_VENUES);
      return;
    }
    let cancelled = false;
    void Promise.all(slugs.map(worldPeakBySlug)).then((found) => {
      if (!cancelled) setSavedPeaks(found.filter((venue): venue is Venue => Boolean(venue)));
    });
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  const allVenues = useMemo(() => {
    if (!dataset) return NO_VENUES;
    if (!worldPeaks.length && !savedPeaks.length) return dataset.venues;
    const onScreen = new Set(worldPeaks.map((peak) => peak.slug));
    return [...dataset.venues, ...worldPeaks, ...savedPeaks.filter((peak) => !onScreen.has(peak.slug))];
  }, [dataset, worldPeaks, savedPeaks]);
  const venueBySlug = useMemo(() => {
    const map = new Map(dataset?.bySlug ?? []);
    // Saved summits too, so one picked from search or the Saved chip while its
    // tile is off screen can still be selected and flown to.
    for (const peak of savedPeaks) map.set(peak.slug, peak);
    for (const peak of worldPeaks) map.set(peak.slug, peak);
    if (linkedPeak) map.set(linkedPeak.slug, linkedPeak);
    return map;
  }, [dataset, worldPeaks, savedPeaks, linkedPeak]);

  const venueTypes = useMemo(() => presentVenueTypes(allVenues), [allVenues]);

  // One filtered list feeds the map, the list and the search box, so the chips
  // mean the same thing everywhere. Memoised on the filters object alone: this
  // component re-renders on every pan, and re-scanning ~12k venues for a
  // viewport change the filters do not care about would be pure waste.
  const savedForFilter = filters.savedOnly ? favorites : null;
  const venues = useMemo(
    () => filterVenues(allVenues, filters, savedForFilter ?? undefined),
    [allVenues, filters, savedForFilter],
  );

  const viewportVenues = useMemo(
    () => (viewport ? venuesInBounds(allVenues, viewport) : allVenues),
    [allVenues, viewport],
  );

  useEffect(() => {
    if (selectedSlug && !venues.some((venue) => venue.slug === selectedSlug)) {
      setSelectedSlug(null);
      setActiveRouteSlug(null);
    }
  }, [venues, selectedSlug]);

  const selectedVenue = selectedSlug ? venueBySlug.get(selectedSlug) ?? null : null;
  const detailVenue = detailSlug ? venueBySlug.get(detailSlug) ?? null : null;
  // A place page opened from a card (its own tab) shows a skeleton of itself
  // until its data arrives, rather than the map page underneath it; and the
  // map is only built once you actually leave the place page for it.
  const detailPending = Boolean(detailSlug && !detailVenue && (!dataset || (isWorldPeakSlug(detailSlug) && !linkedPeak)));
  const [mapNeeded, setMapNeeded] = useState(!detailSlug);
  if (!detailSlug && !mapNeeded) setMapNeeded(true);

  const routesFor = useCallback(
    (venue: Venue | null) => {
      if (!venue) return [];
      const committed = dataset ? routesForVenue(dataset, venue) : [];
      const extra = [...communityRoutes, ...localRoutes].filter((route) => route.venueSlugs.includes(venue.slug));
      return [...committed, ...extra];
    },
    [dataset, localRoutes, communityRoutes],
  );
  const venueRoutes = useMemo(() => routesFor(selectedVenue), [routesFor, selectedVenue]);
  const detailRoutes = useMemo(() => routesFor(detailVenue), [routesFor, detailVenue]);
  const routeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of [...communityRoutes, ...localRoutes]) {
      for (const slug of route.venueSlugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return counts;
  }, [localRoutes, communityRoutes]);

  const allRoutes = useMemo(
    () => [...(dataset?.routes ?? []), ...communityRoutes, ...localRoutes],
    [dataset, communityRoutes, localRoutes],
  );
  const filteredRoutes = useMemo(() => filterRoutes(allRoutes, routeFilters), [allRoutes, routeFilters]);
  const selectedRoute = selectedRouteSlug ? allRoutes.find((route) => route.slug === selectedRouteSlug) ?? null : null;

  // A dropped GPX wins the map over a stored route — it is what you just did.
  const activeRoutePoints: RoutePoint[] | null = useMemo(() => {
    if (droppedGpx) return droppedGpx.points;
    if (selectedRoute) return selectedRoute.coordinates;
    if (!activeRouteSlug) return null;
    return allRoutes.find((route) => route.slug === activeRouteSlug)?.coordinates ?? null;
  }, [droppedGpx, selectedRoute, activeRouteSlug, allRoutes]);

  /**
   * Expanding the map folds the list away on wide screens (as Airbnb's
   * expanded map does); bringing it back returns the list to where it was
   * scrolled to.
   */
  const rememberListScroll = useCallback(() => {
    if (window.scrollY > 0) listScrollRef.current = window.scrollY;
  }, []);
  const restoreListScroll = useCallback(() => {
    const top = listScrollRef.current;
    listScrollRef.current = 0;
    if (top > 0) requestAnimationFrame(() => window.scrollTo({ top }));
  }, []);

  const selectRoute = useCallback(
    (slug: string | null) => {
      setSelectedRouteSlug(slug);
      setRouteHoverIndex(null);
      setSpotlight(null);
      if (slug) {
        track('route_open', slug);
        setSelectedSlug(null);
        setDroppedGpx(null);
        setListOpen(false);
      }
    },
    [],
  );

  const frameRoutes = useCallback((routes: Route[]) => {
    const boxes = routes.map(routeBounds).filter((b): b is Bounds => Boolean(b));
    if (boxes.length === 0) return;
    setFocusBounds({
      bounds: {
        west: Math.min(...boxes.map((b) => b.west)),
        south: Math.min(...boxes.map((b) => b.south)),
        east: Math.max(...boxes.map((b) => b.east)),
        north: Math.max(...boxes.map((b) => b.north)),
      },
      nonce: Date.now(),
    });
  }, []);

  // A route card on the landing page hands its slug over to open straight onto it.
  useEffect(() => {
    if (!dataset) return;
    const pending = sessionStorage.getItem('hillgpx:pendingRoute');
    if (!pending) return;
    sessionStorage.removeItem('hillgpx:pendingRoute');
    if (dataset.routeBySlug.has(pending)) selectRoute(pending);
  }, [dataset, selectRoute]);

  const routeHoverPoint: [number, number] | null =
    selectedRoute && routeHoverIndex != null && selectedRoute.coordinates[routeHoverIndex]
      ? [selectedRoute.coordinates[routeHoverIndex][0], selectedRoute.coordinates[routeHoverIndex][1]]
      : null;

  const selectVenue = useCallback(
    (slug: string | null, fly = false) => {
      setSelectedSlug(slug);
      setActiveRouteSlug(null);
      setUserLocation(null);
      if (fly && slug) {
        const venue = venueBySlug.get(slug);
        if (venue) setFocus({ lng: venue.lng, lat: venue.lat, nonce: Date.now() });
      }
      if (slug) setListOpen(false);
    },
    [venueBySlug],
  );

  // The venue page is its own tab: leaving it is a step forward to the map, never history.back().
  const closeDetail = useCallback(() => {
    window.location.hash = '#map';
  }, []);

  const showDetailOnMap = useCallback(
    (routeSlug?: string) => {
      if (!detailVenue) return;
      closeDetail();
      if (routeSlug) {
        selectRoute(routeSlug);
        return;
      }
      selectVenue(detailVenue.slug, true);
    },
    [closeDetail, detailVenue, selectVenue, selectRoute],
  );

  const toggleFavorite = useCallback((slug: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const onPublished = useCallback((route: Route) => {
    setCommunityRoutes((current) => [route, ...current.filter((existing) => existing.slug !== route.slug)]);
    setPublishedRoute(route);
    logSession({ routeName: route.name, gainM: route.gainM, distanceM: route.distanceM });
  }, []);

  const openImport = useCallback(() => {
    setGpxOpen(true);
  }, []);

  const removeLocalRoute = useCallback(
    (slug: string) => {
      const next = localRoutes.filter((route) => route.slug !== slug);
      saveLocalRoutes(next);
      setLocalRoutes(next);
      setActiveRouteSlug((current) => (current === slug ? null : current));
    },
    [localRoutes],
  );

  // Photos and hazards pinned along the open route, shown in the panel and as map pins.
  const [routePhotosState, setRoutePhotosState] = useState<{ slug: string; photos: RoutePhoto[] } | null>(null);
  const [photoFocus, setPhotoFocus] = useState<{ id: string; nonce: number } | null>(null);
  useEffect(() => {
    if (!selectedRouteSlug) return;
    let cancelled = false;
    fetchRoutePhotos(selectedRouteSlug)
      .then((photos) => {
        if (!cancelled) setRoutePhotosState({ slug: selectedRouteSlug, photos });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedRouteSlug]);
  // Your own uploads show straight away, before the next fetch of the route's photos.
  const [myRoutePhotos, setMyRoutePhotos] = useState<RoutePhoto[]>(NO_PHOTOS);
  const routePhotos = useMemo(() => {
    const approved = routePhotosState && routePhotosState.slug === selectedRouteSlug ? routePhotosState.photos : NO_PHOTOS;
    const mine = myRoutePhotos.filter((photo) => photo.routeSlug === selectedRouteSlug && !approved.some((a) => a.id === photo.id));
    return mine.length ? [...mine, ...approved] : approved;
  }, [routePhotosState, selectedRouteSlug, myRoutePhotos]);

  const spotlightTarget = useMemo(() => {
    const venue = spotlight ? venueBySlug.get(spotlight.slug) : undefined;
    return venue && spotlight ? { venue, nonce: spotlight.nonce } : null;
  }, [venueBySlug, spotlight]);
  const overlapSlugs = useMemo(() => {
    const points = droppedGpx?.points ?? selectedRoute?.coordinates;
    return points ? findOverlaps(points, allRoutes, selectedRoute?.slug).map((overlap) => overlap.route.slug) : [];
  }, [droppedGpx, selectedRoute, allRoutes]);
  // A second tap on the same place lets it go, and the map returns to the route.
  const showPassedVenue = useCallback(
    (slug: string) => setSpotlight((current) => (current?.slug === slug ? null : { slug, nonce: Date.now() })),
    [],
  );

  const gpxHoverPoint: [number, number] | null =
    droppedGpx && gpxHoverIndex != null
      ? [droppedGpx.points[gpxHoverIndex][0], droppedGpx.points[gpxHoverIndex][1]]
      : null;

  // Framing an area is a change of place, so any card still open is describing
  // somewhere you have just left. A pan already clears it; this is the same rule
  // for a move the person asked for by name.
  // On a phone the search also brings the map into view (it was moving the
  // hidden map behind the list), and a stored route left open would be
  // describing the place you just left, so it closes.
  const showArea = useCallback((bounds: Bounds, showMap = true) => {
    setSelectedSlug(null);
    setActiveRouteSlug(null);
    setUserLocation(null);
    setSelectedRouteSlug(null);
    setSpotlight(null);
    if (showMap) setListOpen(false);
    setFocusBounds({ bounds, nonce: Date.now() });
  }, []);

  // A landing-page destination arrives as #map/w,s,e,n — on first load, or as
  // a hash change while the map is already open. Frame it, then tidy the hash
  // so a refresh does not keep yanking the camera back. MapView frames it
  // before the style has loaded and again once it has.
  useEffect(() => {
    const frameHash = () => {
      const bounds = boundsFromHash(window.location.hash);
      if (!bounds) return;
      // A landing-page link opens on the list of what is there, not the map.
      showArea(bounds, false);
      history.replaceState(null, '', '#map');
    };
    frameHash();
    window.addEventListener('hashchange', frameHash);
    return () => window.removeEventListener('hashchange', frameHash);
  }, [showArea]);

  /**
   * A venue picked by name from search, wherever it is. Search covers every
   * loaded venue rather than only what is on screen, so the pick may be one the
   * current chips hide: the filters are cleared rather than leaving the camera
   * on a pin that is not drawn (the chips visibly reset, so nothing is hidden
   * from the person). Asking for a place by name outranks a category chip.
   */
  const pickFromSearch = useCallback(
    (slug: string) => {
      if (mode === 'routes') {
        setMode('climbs');
        setSelectedRouteSlug(null);
      }
      if (!venues.some((venue) => venue.slug === slug)) setFilters(NO_FILTERS);
      selectVenue(slug, true);
    },
    [mode, venues, selectVenue],
  );

  const routeOpen = Boolean(droppedGpx || selectedRoute);
  const mapFullWidth = mapExpanded;

  // The sticky header and category bar are measured so the sticky map below
  // them can be exactly as tall as the rest of the window.
  const topRef = useRef<HTMLDivElement>(null);
  const [topHeight, setTopHeight] = useState(0);
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setTopHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateHint('This browser does not support location sharing.');
      return;
    }
    // Nothing to measure "nearest" against until the data has loaded.
    if (allVenues.length === 0) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const [closest] = nearest(allVenues, longitude, latitude, 1);
        const gapM = closest ? haversineM(longitude, latitude, closest.lng, closest.lat) : Infinity;
        if (gapM > 100_000) {
          setLocateHint(`The nearest mapped climb is about ${Math.round(gapM / 1000)} km away. Know a hill near you? Add it from the menu.`);
          setUserLocation({ lng: longitude, lat: latitude });
          setFocus({ lng: longitude, lat: latitude, nonce: Date.now() });
          return;
        }
        const nearby = tallestWithin(allVenues, longitude, latitude, 2_000, 8);
        setSelectedSlug(null);
        setActiveRouteSlug(null);
        setLocateHint(null);
        setUserLocation({ lng: longitude, lat: latitude });
        const bounds = boundsOf([{ lng: longitude, lat: latitude }, ...nearby.map((n) => n.venue)]);
        if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
      },
      (err) => {
        setLocateHint(
          err.code === err.PERMISSION_DENIED
            ? 'To improve accuracy, enable location sharing in your browser settings.'
            : err.code === err.TIMEOUT
              ? 'Timed out waiting for your location.'
              : 'Could not get your location.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [allVenues]);

  return (
    <div className="app map-page" style={{ '--map-top': `${topHeight}px` } as React.CSSProperties}>
      {/* Header and category bar stay put while the page scrolls the list. */}
      <div className="map-top" ref={topRef}>
        <SiteHeader center={<SearchBar venues={allVenues} onPick={pickFromSearch} onFitBounds={showArea} />} />

        <div className={`map-filters${routeOpen && mapFullWidth ? ' folded' : ''}`} aria-hidden={routeOpen && mapFullWidth ? true : undefined}>
        <div>
        <FilterBar
          types={venueTypes}
          visibleVenues={viewportVenues}
          viewport={viewport}
          filters={filters}
          savedCount={favorites.size}
          onChange={(next) => {
            // Saved places can be anywhere in the world: frame them all when the chip is picked.
            if (next.savedOnly && !filters.savedOnly) {
              const bounds = boundsOf(allVenues.filter((venue) => favorites.has(venue.slug)));
              if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
            }
            setFilters(next);
          }}
          mode={mode}
          onModeChange={(next) => {
            setMode(next);
            setSelectedSlug(null);
            if (next === 'climbs') selectRoute(null);
          }}
          routes={allRoutes}
          routeFilters={routeFilters}
          onRouteFiltersChange={setRouteFilters}
        />
        </div>
        </div>
      </div>

      <main className={`stage${mapFullWidth ? ' map-expanded' : ''}${listOpen ? ' list-open' : ''}`}>
        {/* Wide screens start split and can expand the map; small screens toggle views. */}
        <div className={`list-pane${listOpen ? ' open' : ''}`}>
          {!dataset && !loadError && <ListSkeleton />}
          {dataset && mode === 'climbs' && (
            <ResultsList
              venues={venues}
              bounds={viewport}
              routeCounts={routeCounts}
              onHover={setHoveredSlug}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              onShowPlaces={(places) => {
                const bounds = boundsOf(places);
                if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
              }}
            />
          )}
          {dataset && mode === 'routes' && (
            <RoutesList
              routes={filteredRoutes}
              bounds={viewport}
              selectedSlug={selectedRouteSlug}
              onSelect={selectRoute}
              onHover={setHoveredRouteSlug}
              onImport={openImport}
              onShowAll={frameRoutes}
            />
          )}
        </div>

        {loadError ? (
          <div className="empty">
            <h2>Nothing to show yet</h2>
            <p className="small muted">{loadError}</p>
            <pre>
              <code>python scripts/build_data.py</code>
            </pre>
          </div>
        ) : (
          <div className="map-wrap">
            <Suspense fallback={<div className="map-skeleton"><div className="map-skeleton-pulse" /></div>}>
              {mapNeeded && <MapView
                allRoutes={mode === 'routes' ? filteredRoutes : allRoutes}
                mode={mode}
                selectedRouteSlug={selectedRouteSlug}
                hoveredRouteSlug={hoveredRouteSlug}
                onSelectRoute={selectRoute}
                onHoverRoute={setHoveredRouteSlug}
                venues={mode === 'routes' ? NO_VENUES : venues}
                selectedSlug={selectedSlug}
                selectedVenue={selectedVenue}
                routes={venueRoutes}
                activeRoute={activeRoutePoints}
                onSelectVenue={(slug) => selectVenue(slug)}
                hoveredSlug={hoveredSlug}
                onHover={setHoveredSlug}
                focus={focus}
                focusBounds={focusBounds}
                mapExpanded={mapFullWidth}
                onToggleExpand={() => {
                  if (mapExpanded) restoreListScroll();
                  else {
                    rememberListScroll();
                    track('map_expand');
                  }
                  setMapExpanded(!mapExpanded);
                }}
                injectedVenueSlugs={droppedGpx?.venueSlugs ?? []}
                hoverPoint={gpxHoverPoint ?? routeHoverPoint}
                onRouteHover={droppedGpx ? setGpxHoverIndex : setRouteHoverIndex}
                routePanelOpen={Boolean(droppedGpx || selectedRoute)}
                spotlight={spotlightTarget}
                overlapSlugs={overlapSlugs}
                routePhotos={droppedGpx ? NO_PHOTOS : routePhotos}
                photoFocus={photoFocus}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                onLocateHint={setLocateHint}
                userLocation={userLocation}
                onMapError={setMapError}
                onViewportChange={(b, userInitiated) => {
                  // Every zoom or pan ends here, and a new bounds object
                  // re-runs the list's filter over ~12k venues and re-renders
                  // forty image cards. Most gestures barely change what is on
                  // screen, so ignore movements too small to alter the results.
                  setViewport((prev) => (boundsChangedMeaningfully(prev, b) ? b : prev));
                  // A card left pinned over a map you have panned away from is
                  // describing somewhere no longer on screen. Only a real pan
                  // counts — a flyTo from search must not undo its own pick.
                  if (userInitiated) selectVenue(null);
                }}
              />}
            </Suspense>

            {!routeOpen && <OpenSourceBadge placement="on-map" />}

            {mapError && <div className="map-error small">The map failed to load: {mapError}</div>}

            {locateHint && (
              <div className="locate-hint" onClick={handleLocate}>
                <span className="locate-hint-icon" aria-hidden="true">
                  <LocationArrowIcon size={22} />
                </span>
                <div className="locate-hint-body">
                  <p className="locate-hint-title">Share your location</p>
                  <p className="locate-hint-text">{locateHint}</p>
                </div>
                <button
                  type="button"
                  className="locate-hint-close"
                  aria-label="Dismiss location hint"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocateHint(null);
                  }}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            )}

            {!droppedGpx && selectedRoute && (
              <RoutePanel
                route={selectedRoute}
                venuesBySlug={venueBySlug}
                allRoutes={allRoutes}
                hoverIndex={routeHoverIndex}
                onHoverIndex={setRouteHoverIndex}
                onClose={() => selectRoute(null)}
                spotlightSlug={spotlight?.slug ?? null}
                onShowVenue={showPassedVenue}
                onShowRoute={selectRoute}
                routePhotos={routePhotos}
                onFocusPhoto={(photo) => setPhotoFocus({ id: photo.id, nonce: Date.now() })}
                onPhotoAdded={(photo) => {
                  setMyRoutePhotos((current) => [photo, ...current]);
                  setPhotoFocus({ id: photo.id, nonce: Date.now() });
                }}
              />
            )}

            {droppedGpx && (
              <GpxPanel
                key={droppedGpx.fingerprint}
                loaded={droppedGpx}
                venuesBySlug={venueBySlug}
                allRoutes={allRoutes}
                hoverIndex={gpxHoverIndex}
                onHoverIndex={setGpxHoverIndex}
                onClose={() => {
                  setDroppedGpx(null);
                  setPublishedRoute(null);
                  setGpxHoverIndex(null);
                  setSpotlight(null);
                }}
                onPublished={onPublished}
                published={publishedRoute}
                spotlightSlug={spotlight?.slug ?? null}
                onShowVenue={showPassedVenue}
                onShowRoute={selectRoute}
              />
            )}
          </div>
        )}

        {!(selectedVenue && !listOpen) && !((droppedGpx || selectedRoute) && !listOpen) && (
          <button type="button" className="view-toggle" onClick={() => setListOpen((v) => !v)}>
            {listOpen ? (
              <>
                Show map <MapIcon size={16} />
              </>
            ) : (
              <>
                Show list <ListIcon size={16} />
              </>
            )}
          </button>
        )}

        {detailPending && <VenueDetailSkeleton />}

        {detailVenue && (
          <VenueDetail
            venue={detailVenue}
            routes={detailRoutes}
            onShowOnMap={showDetailOnMap}
            isFavorite={favorites.has(detailVenue.slug)}
            onToggleFavorite={() => toggleFavorite(detailVenue.slug)}
            allVenues={allVenues}
            onRemoveLocalRoute={removeLocalRoute}
          />
        )}

        {gpxOpen && (
          <Modal title="Add a GPX route" onClose={() => setGpxOpen(false)}>
            <GpxDropzone
              elevationModel={elevationModel}
              venues={allVenues}
              existingRoutes={allRoutes}
              onShowExisting={(slug) => {
                setGpxOpen(false);
                selectRoute(slug);
              }}
              onLoaded={(loaded) => {
                setSelectedRouteSlug(null);
                setSelectedSlug(null);
                setPublishedRoute(null);
                setDroppedGpx(loaded);
                setGpxHoverIndex(null);
                setSpotlight(null);
                setGpxOpen(false);
                setListOpen(false);
                if (detailSlug) closeDetail();
              }}
            />
          </Modal>
        )}

      </main>

      {/* As on Airbnb: below the list and the map together, full width, reached
          by scrolling past the end of the list while the map stays beside it. */}
      {dataset && <SiteFooter />}
    </div>
  );
}
