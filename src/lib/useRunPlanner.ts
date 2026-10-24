import { useCallback, useMemo, useRef, useState } from 'react';
import type { Route } from '../types';
import { track } from './analytics';
import { countryArea, detectCountry } from './country';
import { askAgain, locate, locationProblemText, type LocateHint, type Located } from './geolocation';
import { lengthText } from './matchText';
import {
  DEFAULT_PACE_S_PER_KM,
  DEFAULT_RUN_LENGTH,
  DEFAULT_TERRAIN,
  matchRoutes,
  type RouteMatch,
  type RunLength,
  type RunNeeds,
  type RunWhere,
  type Terrain,
} from './routeMatch';
import { NEAR_ME_RADII_M, routesBounds } from './routes';
import { formatRadius, type Units } from './units';
import { withPoint, type Bounds } from './venues';

/** The ranked routes the map frames with the runner. */
const FRAMED_MATCHES = 3;

/** What the planner needs from the map page it plans on. */
export interface RunPlannerHost {
  /** The routes to rank: every route, with Route filters applied. */
  routes: Route[];
  units: Units;
  /** The dataset has loaded. */
  ready: boolean;
  /** The location dot on the map. */
  userLocation: Located | null;
  setUserLocation: (here: Located | null) => void;
  showHint: (hint: LocateHint | null) => void;
  frame: (bounds: Bounds) => void;
  /** Switch to Routes mode with nothing open. */
  openRoutes: () => void;
}

export interface RunRanking {
  matches: Map<string, RouteMatch>;
  /** "for 45 min, hilly, near you". */
  title: string;
}

function needsFor(where: RunWhere | null, length: RunLength | null, terrain: Terrain): RunNeeds {
  return { where, length, terrain, paceSPerKm: DEFAULT_PACE_S_PER_KM };
}

/**
 * Routes mode's run planner (RunNeedsBar): how long and what kind always
 * have a value; routes are ranked once "where" is known. "Where" comes from
 * Routes near me's chain: your location (routes within 10 km, else 50 km),
 * then, when nothing is in reach or there is no location, your country
 * (Cloudflare, then the time zone), with a note saying so.
 */
export function useRunPlanner(host: RunPlannerHost) {
  const { routes, units, ready, userLocation, setUserLocation, showHint, frame, openRoutes } = host;
  const [length, setLengthState] = useState<RunLength>(DEFAULT_RUN_LENGTH);
  const [terrain, setTerrainState] = useState<Terrain>(DEFAULT_TERRAIN);
  const [where, setWhere] = useState<{ where: RunWhere; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The dot before planning, and the one planning put there: Clear puts the
  // first back, unless something else has moved the dot since.
  const dotBefore = useRef<Located | null>(null);
  const dotSet = useRef<Located | null>(null);

  const ranked = useMemo(() => (where ? matchRoutes(routes, needsFor(where.where, length, terrain)) : null), [routes, where, length, terrain]);
  const ranking = useMemo<RunRanking | null>(() => {
    if (!ranked || !where) return null;
    const place = where.where.kind === 'point' ? 'near you' : `in ${where.label}`;
    return {
      matches: new Map(ranked.matches.map((match) => [match.route.slug, match])),
      title: `for ${lengthText(length, units)}${terrain === 'any' ? '' : `, ${terrain}`}, ${place}`,
    };
  }, [ranked, where, length, terrain, units]);
  // Ranked: best first. Otherwise the most climbing first, as before.
  const listedRoutes = useMemo(
    () => (ranked ? ranked.matches.map((match) => match.route) : [...routes].sort((a, b) => b.gainM - a.gainM)),
    [ranked, routes],
  );

  /** Frame the runner (when located) with the best few matches for these needs. */
  const frameRun = useCallback(
    (needs: RunNeeds) => {
      const top = matchRoutes(routes, needs).matches.slice(0, FRAMED_MATCHES).map((match) => match.route);
      const box = routesBounds(top);
      const at = needs.where;
      if (box) frame(at?.kind === 'point' ? withPoint(box, at) : box);
      else if (at?.kind === 'area') frame(at.bounds);
    },
    [routes, frame],
  );

  /** Rank from here on: open Routes mode on the ranked list and frame it. */
  const start = useCallback(
    (at: RunWhere, label: string, hint: LocateHint | null) => {
      if (!where) dotBefore.current = userLocation;
      openRoutes();
      showHint(hint);
      const dot = at.kind === 'point' ? { lng: at.lng, lat: at.lat } : null;
      dotSet.current = dot;
      setUserLocation(dot);
      setWhere({ where: at, label });
      frameRun(needsFor(at, length, terrain));
    },
    [where, userLocation, openRoutes, showHint, setUserLocation, frameRun, length, terrain],
  );

  const plan = useCallback(() => {
    if (!ready) return;
    track('run_needs_submit', `${length.kind === 'time' ? `${length.minutes} min` : `${Math.round(length.metres)} m`} ${terrain}`);
    setBusy(true);
    const inCountry = async (note: (country: string) => string, retry: boolean, problem: string) => {
      const code = await detectCountry();
      const area = code ? await countryArea(code) : null;
      setBusy(false);
      if (!area) {
        showHint(askAgain(problem, 'plan'));
        return;
      }
      start({ kind: 'area', bounds: area.bounds }, area.name, { title: `Routes in ${area.name}`, text: note(area.name), retry: retry ? 'plan' : null });
    };
    locate(
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      (here) => {
        const at: RunWhere = { kind: 'point', ...here };
        const reach = matchRoutes(routes, needsFor(at, null, 'any')).reachM;
        if (reach != null) {
          setBusy(false);
          const first = NEAR_ME_RADII_M[0];
          const widened: LocateHint | null =
            reach > first
              ? { title: 'Routes near you', text: `No routes within ${formatRadius(first, units)}, so these are ranked within ${formatRadius(reach, units)}.`, retry: null }
              : null;
          start(at, 'Near you', widened);
          return;
        }
        const widest = formatRadius(NEAR_ME_RADII_M[NEAR_ME_RADII_M.length - 1], units);
        void inCountry((country) => `No routes within ${widest} of you. Ranking routes in ${country}.`, false, `No routes within ${widest} of you.`);
      },
      (problem) => {
        const text = locationProblemText(problem, 'Allow location to rank routes near you.');
        void inCountry((country) => `${text} Ranking routes in ${country} instead.`, true, text);
      },
    );
  }, [ready, length, terrain, routes, units, showHint, start]);

  /** Change one need: re-rank (the list follows) and re-frame straight away. */
  const setLength = useCallback(
    (next: RunLength) => {
      setLengthState(next);
      if (where) frameRun(needsFor(where.where, next, terrain));
    },
    [where, terrain, frameRun],
  );
  const setTerrain = useCallback(
    (next: Terrain) => {
      setTerrainState(next);
      if (where) frameRun(needsFor(where.where, length, next));
    },
    [where, length, frameRun],
  );

  /** Back to plain browsing, with the location dot as it was before planning. */
  const clear = useCallback(() => {
    setWhere(null);
    showHint(null);
    if (userLocation === dotSet.current) setUserLocation(dotBefore.current);
    dotBefore.current = null;
    dotSet.current = null;
  }, [userLocation, showHint, setUserLocation]);

  /** Opening a route from the ranked list or a map pin. */
  const noteOpened = useCallback(
    (slug: string | null) => {
      if (slug && ranking?.matches.has(slug)) track('ranked_route_open', slug);
    },
    [ranking],
  );

  return {
    length,
    terrain,
    whereLabel: where?.label ?? null,
    busy,
    ranking,
    listedRoutes,
    plan,
    setLength,
    setTerrain,
    clear,
    noteOpened,
  };
}
