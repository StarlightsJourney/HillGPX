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
import { RunNeedsBar } from './components/RunNeedsBar';
import { useRouteBookmarks } from './lib/useRouteBookmarks';
import { toggleSavedPlace, useSavedPlaces } from './lib/saved';
import { useRunPlanner } from './lib/useRunPlanner';
import { usePanelFold } from './lib/usePanelFold';
import { askAgain, locate, locationProblemText, NEAR_ME_OPTIONS, type LocateHint } from './lib/geolocation';
import { NEAR_ME_RADII_M, NO_ROUTE_FILTERS, filterRoutes, linkVenues, radiusBounds, routesBounds, routesNear, routesWithin, routeIntersects, routeSlugFromHash, type RouteFilters } from './lib/routes';
import { boundsFromHash } from './lib/regions';
import { ElevationModel } from './lib/elevation';
import {
  NO_FILTERS,
  boundsOf,
  inBounds,
  filterVenues,
  loadDataset,
  nearest,
  presentVenueTypes,
  routesForVenue,
  tallestWithin,
  venuesInBounds,
  withPoint,
  type Bounds,
  type Dataset,
  type VenueFilters,
} from './lib/venues';
import { haversineM } from './lib/elevation';
import type { Route, RoutePoint, Venue } from './types';
import { ListIcon, MapIcon } from './components/icons';
import { LocateNote } from './components/LocateNote';
import { loadLocalRoutes, saveLocalRoutes } from './lib/localRoutes';
import { logSession } from './lib/training';
import { TrainingPanel } from './components/TrainingPanel';
import { AccountPage } from './components/AccountPage';
import { InfoPage, type InfoPageId } from './components/InfoPage';
import { SettingsPage } from './components/SettingsPage';
import { parseAccountHash } from './lib/accountRoute';
import { UnitsProvider, useUnits } from './components/UnitsContext';
import { Modal } from './components/Modal';
import { SiteFooter, SiteHeader } from './components/SiteChrome';
import { OpenSourceBadge, OpenSourceNotice } from './components/OpenSourceNotice';
import { errorText, fetchCommunityRoutes, fetchRoutePhotos, type RoutePhoto } from './lib/api';
import { findOverlaps } from './lib/routeAnalysis';
import { IMPORT_EVENT, REPORT_EVENT, type ReportRequest } from './lib/contribute';
import { ReportModal } from './components/ReportModal';
import { SetPasswordModal } from './components/AuthModal';
import { clearPasswordRecovery, usePasswordRecovery } from './lib/auth';
import { track } from './lib/analytics';
import { takeMapIntent } from './lib/mapIntent';
import { countryArea, detectCountry } from './lib/country';
import { formatRadius } from './lib/units';
import { isWorldPeakSlug, peaksInView, worldPeakBySlug } from './lib/worldPeaks';

/** One shared empty list, so "no dataset yet" is a stable reference to memo on. */
const NO_VENUES: Venue[] = [];
const NO_PHOTOS: RoutePhoto[] = [];

// MapLibre is by far the largest dependency here. Code-splitting it keeps the
// landing page down to a small bundle that paints immediately; the map is only
// fetched once someone actually opens it.
const MapView = lazy(() => import('./map/MapView').then((m) => ({ default: m.MapView })));

type View = 'landing' | 'map' | 'training' | 'account' | 'settings' | InfoPageId;

const INFO_PAGES: ReadonlySet<string> = new Set<InfoPageId>(['privacy', 'terms', 'contact']);

function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash === '#map' || hash === '#routes' || hash === '#import' || hash.startsWith('#map/') || hash.startsWith('#venue/') || hash.startsWith('#route/')) return 'map';
  if (hash === '#training') return 'training';
  const account = parseAccountHash(hash);
  if (account) return account.page;
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
  // A reset-password email link opens a recovery session — collect the new password.
  const recovering = usePasswordRecovery();
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
        <Landing />
      ) : view === 'training' ? (
        <TrainingPanel />
      ) : view === 'account' ? (
        <AccountPage />
      ) : view === 'settings' ? (
        <SettingsPage />
      ) : view !== 'map' ? (
        <InfoPage page={view} />
      ) : (
        <MapApp />
      )}
      {view === 'landing' && <OpenSourceNotice />}
      {report && <ReportModal targetType={report.targetType} targetSlug={report.targetSlug} targetName={report.targetName} onClose={() => setReport(null)} />}
      {recovering && <SetPasswordModal onClose={clearPasswordRecovery} />}
      {view !== 'map' && view !== 'account' && view !== 'settings' && <OpenSourceBadge placement={view === 'landing' ? 'landing' : 'corner'} />}
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

/**
 * "Routes near me" looks NEAR_ME_RADII_M (5 km) around you before it falls
 * back on your country (see handleLocate), and shows at most this many.
 */
const NEARBY_ROUTES = 8;
/** A summit picked in search opens on the routes passing this close to it. */
const PLACE_ROUTE_RADIUS_M = 10_000;

function MapApp() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [elevationModel, setElevationModel] = useState<ElevationModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeRouteSlug, setActiveRouteSlug] = useState<string | null>(null);
  const [detailSlug, setDetailSlug] = useState(detailSlugFromHash);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const favorites = useSavedPlaces();
  const [localRoutes, setLocalRoutes] = useState<Route[]>(loadLocalRoutes);
  const [droppedGpx, setDroppedGpx] = useState<LoadedGpx | null>(null);
  const [gpxHoverIndex, setGpxHoverIndex] = useState<number | null>(null);
  // The kept range of the dropped track while it is being trimmed: null means
  // the whole file. Indices into droppedGpx.points, so map, profile and panel
  // all talk about the same two numbers.
  const [gpxTrim, setGpxTrim] = useState<[number, number] | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
  const [focusBounds, setFocusBounds] = useState<{ bounds: Bounds; nonce: number } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  // The card over the map after "near me": why the map shows what it shows,
  // and (when `retry`) a tap to ask for the location again.
  const [locateHint, setLocateHint] = useState<LocateHint | null>(null);
  const units = useUnits();
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
  // Settled (loaded or failed): a search can now tell whether a place has routes.
  const [routesReady, setRoutesReady] = useState(false);
  const [publishedRoute, setPublishedRoute] = useState<Route | null>(null);
  const [worldPeaks, setWorldPeaks] = useState<Venue[]>(NO_VENUES);
  // A summit opened by link or favourite whose tile is not on screen.
  const [linkedPeak, setLinkedPeak] = useState<Venue | null>(null);
  const [filters, setFilters] = useState<VenueFilters>(NO_FILTERS);
  const [mode, setMode] = useState<BrowseMode>(() =>
    window.location.hash === '#routes' || routeSlugFromHash(window.location.hash) || sessionStorage.getItem('hillgpx:mode') === 'routes' ? 'routes' : 'climbs',
  );
  const [routeFilters, setRouteFilters] = useState<RouteFilters>(NO_ROUTE_FILTERS);
  const [selectedRouteSlug, setSelectedRouteSlug] = useState<string | null>(null);
  const [hoveredRouteSlug, setHoveredRouteSlug] = useState<string | null>(null);
  const [routeHoverIndex, setRouteHoverIndex] = useState<number | null>(null);
  // Post-publish editing of your own upload: which route's panel is in edit
  // mode, and the kept range while trimming (the cut ends draw ghosted).
  const [routeEdit, setRouteEdit] = useState<{ slug: string; trim: [number, number] | null } | null>(null);
  // A venue picked from a route's "Passes" list: pinned on the map beside the
  // route rather than opening its detail page over it.
  const [spotlight, setSpotlight] = useState<{ slug: string; nonce: number } | null>(null);
  const [viewport, setViewport] = useState<
    { west: number; south: number; east: number; north: number } | null
  >(null);
  // The box last searched or opened from a link (showArea). It ranks the list
  // only while the map's centre is still inside it, so panning away by hand
  // goes back to plain ranking without anything having to clear it.
  const [searchedBox, setSearchedBox] = useState<Bounds | null>(null);
  const activeSearchedBox =
    searchedBox && viewport && inBounds(searchedBox, (viewport.west + viewport.east) / 2, (viewport.south + viewport.north) / 2)
      ? searchedBox
      : null;

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((err: unknown) => setLoadError(errorText(err)));

    // A few megabytes, and only the GPX profile needs it, so the map stays
    // fully usable while it loads — or if it never does.
    ElevationModel.load()
      .then(setElevationModel)
      .catch((err: Error) => console.warn('Terrain model unavailable:', err.message));

    // Community routes are an addition to the committed ones; the map works without them.
    fetchCommunityRoutes()
      .then(setCommunityRoutes)
      .catch((err: Error) => console.warn('Community routes unavailable:', err.message))
      .finally(() => setRoutesReady(true));

    if (window.location.hash === '#import') history.replaceState(null, '', '#map');
  }, []);

  // "Upload GPX" on a venue page opens the dialog over that page (openImportHere).
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

  // The part of the dropped track the trim handles keep. The map still draws
  // the whole thing so the cut is visible, but everything downstream — stats,
  // linked places, the published route — works from this slice.
  const gpxKeptPoints = useMemo(() => {
    if (!droppedGpx) return null;
    return gpxTrim ? droppedGpx.points.slice(gpxTrim[0], gpxTrim[1] + 1) : droppedGpx.points;
  }, [droppedGpx, gpxTrim]);
  const gpxVenueSlugs = useMemo(() => {
    if (!droppedGpx || !gpxKeptPoints) return [];
    return gpxTrim ? linkVenues(gpxKeptPoints, allVenues) : droppedGpx.venueSlugs;
  }, [droppedGpx, gpxKeptPoints, gpxTrim, allVenues]);

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
  const routeBookmarks = useRouteBookmarks();
  const filteredRoutes = useMemo(() => filterRoutes(allRoutes, routeFilters, routeBookmarks), [allRoutes, routeFilters, routeBookmarks]);
  const selectedRoute = selectedRouteSlug ? allRoutes.find((route) => route.slug === selectedRouteSlug) ?? null : null;
  const panelFold = usePanelFold(selectedRoute?.slug ?? null);

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
      setRouteEdit(null);
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
    const bounds = routesBounds(routes);
    if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
  }, []);

  // A route card on the landing page hands its slug over to open straight onto it.
  useEffect(() => {
    if (!dataset) return;
    const pending = sessionStorage.getItem('hillgpx:pendingRoute');
    if (!pending) return;
    sessionStorage.removeItem('hillgpx:pendingRoute');
    if (allRoutes.some((route) => route.slug === pending)) selectRoute(pending);
  }, [dataset, allRoutes, selectRoute]);

  // A shared link (#route/<slug>) opens on that route, once the routes have loaded.
  const [linkedRoute, setLinkedRoute] = useState<string | null>(() => routeSlugFromHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      const slug = routeSlugFromHash(window.location.hash);
      if (slug) setLinkedRoute(slug);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!linkedRoute || !dataset || !routesReady) return;
    setLinkedRoute(null);
    // Back to an ordinary map address, so the bar never names a route that is no longer open.
    history.replaceState(null, '', '#routes');
    setMode('routes');
    if (allRoutes.some((route) => route.slug === linkedRoute)) {
      selectRoute(linkedRoute);
    } else {
      setLocateHint({ title: "That route isn't available", text: 'It may have been removed. Here are the routes on the map.', retry: null });
    }
  }, [linkedRoute, dataset, routesReady, allRoutes, selectRoute]);

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

  const toggleFavorite = toggleSavedPlace;

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
    setSearchedBox(bounds);
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
    (slug: string, showMap = true) => {
      // Routes first: a summit with routes around it opens on those routes,
      // framed with the summit; one without them opens on its own card.
      const venue = venueBySlug.get(slug);
      const routeBox = venue ? routesBounds(routesNear(filteredRoutes, venue.lng, venue.lat, PLACE_ROUTE_RADIUS_M, NEARBY_ROUTES)) : null;
      if (venue && routeBox) {
        setMode('routes');
        showArea(withPoint(routeBox, venue), showMap);
        return;
      }
      if (mode === 'routes') {
        setMode('climbs');
        setSelectedRouteSlug(null);
      }
      if (!venues.some((venue) => venue.slug === slug)) setFilters(NO_FILTERS);
      selectVenue(slug, true);
    },
    [mode, venues, venueBySlug, filteredRoutes, showArea, selectVenue],
  );

  /** A searched area opens on its routes when it has any, otherwise on its climbs. */
  const searchArea = useCallback(
    (bounds: Bounds, showMap = true) => {
      setMode(filteredRoutes.some((route) => routeIntersects(route, bounds)) ? 'routes' : 'climbs');
      showArea(bounds, showMap);
    },
    [filteredRoutes, showArea],
  );

  const routeOpen = Boolean(droppedGpx || selectedRoute);
  const mapFullWidth = mapExpanded;

  // The sticky header and category bar are measured so the sticky map below
  // them can be exactly as tall as the rest of the window. The height is
  // written straight onto the page in the observer, before the frame paints:
  // going through React state lagged a frame, so while the category bar slid
  // in or out the map was briefly too tall and the page jolted.
  const topRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topRef.current;
    const pageEl = pageRef.current;
    if (!el || !pageEl) return;
    const observer = new ResizeObserver(() => pageEl.style.setProperty('--map-top', `${el.offsetHeight}px`));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Clear what was open and frame the routes "near me" found. */
  const showNearbyRoutes = useCallback((bounds: Bounds, here: { lng: number; lat: number } | null, hint: LocateHint | null) => {
    setMode('routes');
    setSelectedSlug(null);
    setActiveRouteSlug(null);
    setSelectedRouteSlug(null);
    setSpotlight(null);
    setLocateHint(hint);
    setUserLocation(here);
    setFocusBounds({ bounds, nonce: Date.now() });
  }, []);

  /**
   * Without a usable location, the visitor's country (lib/country.ts): its
   * routes, or its climbs when it has none. False when the country is not
   * known, so the caller can say why instead. The note closes by itself even
   * without a location: the locate button is always there to ask again.
   */
  const showCountry = useCallback(
    async (note: (country: string, kind: 'routes' | 'climbs') => string, here: { lng: number; lat: number } | null = null) => {
      const code = await detectCountry();
      const area = code ? await countryArea(code) : null;
      if (!area) return false;
      const hasRoutes = filteredRoutes.some((route) => routeIntersects(route, area.bounds));
      const hint: LocateHint = { title: hasRoutes ? `Routes in ${area.name}` : `Climbs in ${area.name}`, text: note(area.name, hasRoutes ? 'routes' : 'climbs'), retry: null };
      if (hasRoutes) {
        showNearbyRoutes(area.bounds, here, hint);
      } else {
        searchArea(area.bounds);
        setLocateHint(hint);
      }
      return true;
    },
    [filteredRoutes, showNearbyRoutes, searchArea],
  );

  /** No routes anywhere near: the climbs around you, as before routes came first. */
  const showNearbyClimbs = useCallback(
    (here: { lng: number; lat: number }) => {
      setMode('climbs');
      setSelectedSlug(null);
      setActiveRouteSlug(null);
      setUserLocation(here);
      const [closest] = nearest(allVenues, here.lng, here.lat, 1);
      const gapM = closest ? haversineM(here.lng, here.lat, closest.lng, closest.lat) : Infinity;
      if (gapM > 100_000) {
        setLocateHint({
          title: 'Nothing mapped near you yet',
          text: `The nearest mapped climb is about ${Math.round(gapM / 1000)} km away. Know a hill near you? Add it with Upload GPX.`,
          retry: null,
        });
        setFocus({ ...here, nonce: Date.now() });
        return;
      }
      setLocateHint(null);
      const nearby = tallestWithin(allVenues, here.lng, here.lat, 2_000, 8);
      const bounds = boundsOf([here, ...nearby.map((n) => n.venue)]);
      if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
    },
    [allVenues],
  );

  /**
   * "Routes near me". With your location: the routes within 5 km, else in
   * your country, else the climbs around you. Without it (denied,
   * unsupported, timed out): your country's routes, or its climbs. A note on
   * the map says which of these you are looking at.
   */
  // A near-me tap before the data has loaded waits for it rather than dying.
  const [queuedLocate, setQueuedLocate] = useState(0);

  const handleLocate = useCallback(() => {
    // Nothing to measure "nearest" against until the data has loaded.
    if (allVenues.length === 0) {
      setLocateHint({ title: 'Finding you…', text: 'The map data is still loading.', retry: null });
      setQueuedLocate(Date.now());
      return;
    }
    // A fix can take a moment; say something is happening from the first tap.
    setLocateHint({ title: 'Finding you…', text: 'Asking your browser for your position.', retry: null });
    const fallBack = (problem: string) => {
      void showCountry((country, kind) =>
        kind === 'routes'
          ? `${problem} Showing routes in ${country} instead.`
          : `${problem} ${country} has no routes yet, so here are its climbs.`,
      ).then((shown) => {
        if (!shown) setLocateHint(askAgain(problem));
      });
    };
    locate(
      NEAR_ME_OPTIONS,
      (here) => {
        const widest = NEAR_ME_RADII_M[NEAR_ME_RADII_M.length - 1];
        const hit = routesWithin(filteredRoutes, here.lng, here.lat, NEAR_ME_RADII_M, NEARBY_ROUTES);
        if (hit) {
          // The view is the radius that was searched: every route in the
          // list is inside it, and you sit at its centre.
          showNearbyRoutes(radiusBounds(here.lng, here.lat, widest), here, null);
          return;
        }
        void showCountry(
          (country, kind) => `No routes within ${formatRadius(widest, units.units)} of you. ${kind === 'routes' ? `Showing routes in ${country}.` : `${country} has no routes yet, so here are its climbs.`}`,
          here,
        ).then((shown) => {
          if (!shown) showNearbyClimbs(here);
        });
      },
      (problem) => fallBack(locationProblemText(problem, 'Allow location to see routes near you.')),
    );
  }, [allVenues, filteredRoutes, units.units, showCountry, showNearbyRoutes, showNearbyClimbs]);

  // The tap landed while the data was still loading: run it now.
  useEffect(() => {
    if (queuedLocate && allVenues.length > 0) {
      setQueuedLocate(0);
      handleLocate();
    }
  }, [queuedLocate, allVenues, handleLocate]);

  const frameBounds = useCallback((bounds: Bounds) => setFocusBounds({ bounds, nonce: Date.now() }), []);
  const openRoutesMode = useCallback(() => {
    setMode('routes');
    setSelectedSlug(null);
    setActiveRouteSlug(null);
    setSelectedRouteSlug(null);
    setSpotlight(null);
  }, []);
  const planner = useRunPlanner({
    routes: filteredRoutes,
    units: units.units,
    ready: dataset != null,
    userLocation,
    setUserLocation,
    showHint: setLocateHint,
    frame: frameBounds,
    openRoutes: openRoutesMode,
  });
  const { noteOpened } = planner;
  /** Open a route from the list or a map pin. */
  const openRoute = useCallback(
    (slug: string | null) => {
      noteOpened(slug);
      selectRoute(slug);
    },
    [noteOpened, selectRoute],
  );

  /** A route found by name in the search: open it in Routes mode. */
  const pickRouteFromSearch = useCallback(
    (slug: string) => {
      setMode('routes');
      openRoute(slug);
    },
    [openRoute],
  );

  /** Select one place and frame it, as tapping its pin does. */
  const openVenue = useCallback(
    (slug: string) => {
      setMode('climbs');
      selectRoute(null);
      setFilters(NO_FILTERS);
      selectVenue(slug);
      const known = venueBySlug.get(slug);
      const found = known ? Promise.resolve(known) : isWorldPeakSlug(slug) ? worldPeakBySlug(slug) : Promise.resolve(null);
      void found.then((venue) => venue && setFocus({ lng: venue.lng, lat: venue.lat, nonce: Date.now() }));
    },
    [selectRoute, selectVenue, venueBySlug],
  );

  // A search or "near me" from a page without the map (mapIntent.ts) runs once
  // the routes it chooses between have loaded. On the map page itself (the
  // venue page's search) the hash change wakes this up.
  const [intentNonce, setIntentNonce] = useState(0);
  useEffect(() => {
    const wake = () => setIntentNonce((n) => n + 1);
    window.addEventListener('hashchange', wake);
    return () => window.removeEventListener('hashchange', wake);
  }, []);
  useEffect(() => {
    if (!dataset || !routesReady) return;
    const intent = takeMapIntent();
    if (!intent) return;
    if (intent.kind === 'near-me') handleLocate();
    else if (intent.kind === 'area') searchArea(intent.bounds, false);
    else if (intent.kind === 'saved') {
      // From the account page: open the same Saved view the category bar shows.
      setSelectedSlug(null);
      selectRoute(null);
      if (intent.what === 'routes') {
        setMode('routes');
        setRouteFilters((current) => ({ ...current, category: 'saved' }));
        const bounds = routesBounds(allRoutes.filter((route) => routeBookmarks.has(route.slug)));
        if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
      } else {
        setMode('climbs');
        setFilters((current) => ({ ...current, savedOnly: true }));
        const bounds = boundsOf(allVenues.filter((venue) => favorites.has(venue.slug)));
        if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
      }
    } else if (intent.kind === 'venue') openVenue(intent.slug);
    else if (intent.kind === 'route') {
      pickRouteFromSearch(intent.slug);
      // From the account's pencil: land straight in the panel's edit mode.
      // Ownership is re-checked in the panel — the flag only asks for it.
      if (intent.edit) setRouteEdit({ slug: intent.slug, trim: null });
    }
    else pickFromSearch(intent.slug, false);
  }, [dataset, routesReady, intentNonce, handleLocate, searchArea, pickFromSearch, pickRouteFromSearch, selectRoute, allRoutes, allVenues, routeBookmarks, favorites, openVenue]);

  return (
    <div className={`app map-page${mapFullWidth ? ' is-expanded' : ''}${routeOpen && mapFullWidth ? ' bar-folded' : ''}`} ref={pageRef}>
      {/* Header and category bar stay put while the page scrolls the list. */}
      <div className="map-top" ref={topRef}>
        <SiteHeader center={<SearchBar venues={allVenues} routes={allRoutes} onPick={pickFromSearch} onPickRoute={pickRouteFromSearch} onFitBounds={searchArea} onLocate={handleLocate} />} />

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
          onRouteFiltersChange={(next) => {
            // Bookmarked routes can be anywhere: frame them all when Saved is picked.
            if (next.category === 'saved' && routeFilters.category !== 'saved') {
              const bounds = routesBounds(allRoutes.filter((route) => routeBookmarks.has(route.slug)));
              if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
            }
            setRouteFilters(next);
          }}
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
              searched={activeSearchedBox}
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
            <>
            <RunNeedsBar
              whereLabel={planner.whereLabel}
              busy={planner.busy}
              onPlan={planner.plan}
              onClear={planner.clear}
            />
            <RoutesList
              routes={planner.listedRoutes}
              ranking={planner.ranking}
              savedOnly={routeFilters.category === 'saved'}
              bounds={viewport}
              selectedSlug={selectedRouteSlug}
              onSelect={openRoute}
              onHover={setHoveredRouteSlug}
              onImport={openImport}
              onShowAll={frameRoutes}
            />
            </>
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
                allRoutes={mode === 'routes' ? planner.listedRoutes : allRoutes}
                mode={mode}
                selectedRouteSlug={selectedRouteSlug}
                hoveredRouteSlug={hoveredRouteSlug}
                onSelectRoute={openRoute}
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
                injectedVenueSlugs={gpxVenueSlugs}
                activeRouteTrim={droppedGpx ? gpxTrim : routeEdit && routeEdit.slug === selectedRouteSlug ? routeEdit.trim : null}
                hoverPoint={gpxHoverPoint ?? routeHoverPoint}
                onRouteHover={droppedGpx ? setGpxHoverIndex : setRouteHoverIndex}
                routePanelOpen={Boolean(droppedGpx || selectedRoute)}
                spotlight={spotlightTarget}
                overlapSlugs={overlapSlugs}
                routePhotos={droppedGpx ? NO_PHOTOS : routePhotos}
                photoFocus={photoFocus}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                onLocateHint={(text) => setLocateHint(text ? askAgain(text) : null)}
                userLocation={userLocation}
                onMapError={setMapError}
                // The first pan or zoom by hand closes a note that only informs.
                // and folds the route panel out of the way until the map rests.
                onUserMove={() => {
                  setLocateHint((hint) => (hint && hint.retry === null ? null : hint));
                  panelFold.fold();
                }}
                onUserMoveEnd={panelFold.settle}
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
              <LocateNote
                hint={locateHint}
                onRetry={locateHint.retry === 'plan' ? planner.plan : locateHint.retry === 'near-me' ? handleLocate : undefined}
                onDismiss={() => setLocateHint(null)}
              />
            )}

            {!droppedGpx && selectedRoute && (
              <RoutePanel
                route={selectedRoute}
                venuesBySlug={venueBySlug}
                allRoutes={allRoutes}
                hoverIndex={routeHoverIndex}
                onHoverIndex={setRouteHoverIndex}
                onClose={() => selectRoute(null)}
                folded={panelFold.folded}
                onUnfold={panelFold.unfold}
                spotlightSlug={spotlight?.slug ?? null}
                onShowVenue={showPassedVenue}
                onShowRoute={selectRoute}
                routePhotos={routePhotos}
                onFocusPhoto={(photo) => setPhotoFocus({ id: photo.id, nonce: Date.now() })}
                onPhotoAdded={(photo) => {
                  setMyRoutePhotos((current) => [photo, ...current]);
                  setPhotoFocus({ id: photo.id, nonce: Date.now() });
                }}
                editing={routeEdit?.slug === selectedRoute.slug}
                editTrim={routeEdit?.trim ?? null}
                onEditTrimChange={(trim) => setRouteEdit((current) => (current ? { ...current, trim } : current))}
                onEditStart={() => setRouteEdit({ slug: selectedRoute.slug, trim: null })}
                onEditEnd={(updated) => {
                  setRouteEdit(null);
                  if (updated) {
                    setCommunityRoutes((current) => current.map((existing) => (existing.slug === updated.slug ? updated : existing)));
                  }
                }}
              />
            )}

            {droppedGpx && (
              <GpxPanel
                key={droppedGpx.fingerprint}
                loaded={droppedGpx}
                venuesBySlug={venueBySlug}
                allRoutes={allRoutes}
                venueSlugs={gpxVenueSlugs}
                trim={gpxTrim}
                onTrimChange={setGpxTrim}
                hoverIndex={gpxHoverIndex}
                onHoverIndex={setGpxHoverIndex}
                onClose={() => {
                  setDroppedGpx(null);
                  setPublishedRoute(null);
                  setGpxHoverIndex(null);
                  setGpxTrim(null);
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
          <Modal title="Upload GPX" onClose={() => setGpxOpen(false)}>
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
                setGpxTrim(null);
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
