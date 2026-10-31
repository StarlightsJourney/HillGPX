import { useCallback, useMemo, useRef, useState } from 'react';
import type { Route } from '../types';
import { track } from './analytics';
import { countryArea, detectCountry } from './country';
import { askAgain, locate, locationProblemText, NEAR_ME_OPTIONS, type LocateHint, type Located } from './geolocation';
import {
  DEFAULT_PACE_S_PER_KM,
  matchRoutes,
  type RouteMatch,
  type RunNeeds,
  type RunWhere,
} from './routeMatch';
import { NEAR_ME_RADII_M, radiusBounds, routesBounds } from './routes';
import { formatRadius, type Units } from './units';
import type { Bounds } from './venues';

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
  /** "near you", "in Singapore" — appended to the list's "N routes" heading. */
  title: string;
}

function needsFor(where: RunWhere | null): RunNeeds {
  return { where, length: null, terrain: 'any', paceSPerKm: DEFAULT_PACE_S_PER_KM };
}

/**
 * Routes mode's "routes near me" (RunNeedsBar): a tap on Near me is the only
 * way the location is asked for — nothing in this hook locates on its own.
 * With a fix: the routes within NEAR_ME_RADII_M (5 km). When nothing is in
 * reach or there is no fix, your country (Cloudflare, then the time zone),
 * with a note saying so.
 */
export function useRunPlanner(host: RunPlannerHost) {
  const { routes, units, ready, userLocation, setUserLocation, showHint, frame, openRoutes } = host;
  const [where, setWhere] = useState<{ where: RunWhere; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The dot before planning, and the one planning put there: Clear puts the
  // first back, unless something else has moved the dot since.
  const dotBefore = useRef<Located | null>(null);
  const dotSet = useRef<Located | null>(null);

  const ranked = useMemo(() => (where ? matchRoutes(routes, needsFor(where.where)) : null), [routes, where]);
  const ranking = useMemo<RunRanking | null>(() => {
    if (!ranked || !where) return null;
    const place = where.where.kind === 'point' ? 'near you' : `in ${where.label}`;
    return {
      matches: new Map(ranked.matches.map((match) => [match.route.slug, match])),
      title: place,
    };
  }, [ranked, where]);
  // Ranked: best first. Otherwise the most climbing first, as before.
  const listedRoutes = useMemo(
    () => (ranked ? ranked.matches.map((match) => match.route) : [...routes].sort((a, b) => b.gainM - a.gainM)),
    [ranked, routes],
  );

  /**
   * Frame what "where" means: the searched radius around a located runner,
   * else the best few matches in the area (the area itself when there are
   * none).
   */
  const frameRun = useCallback(
    (needs: RunNeeds) => {
      const at = needs.where;
      if (at?.kind === 'point') {
        frame(radiusBounds(at.lng, at.lat, NEAR_ME_RADII_M[NEAR_ME_RADII_M.length - 1]));
        return;
      }
      const top = matchRoutes(routes, needs).matches.slice(0, FRAMED_MATCHES).map((match) => match.route);
      const box = routesBounds(top);
      if (box) frame(box);
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
      frameRun(needsFor(at));
    },
    [where, userLocation, openRoutes, showHint, setUserLocation, frameRun],
  );

  /** Near me: find where the runner is, then rank what is around them. */
  const plan = useCallback(() => {
    if (!ready) return;
    track('run_needs_submit', 'near-me');
    setBusy(true);
    const inCountry = async (note: (country: string) => string, problem: string) => {
      const code = await detectCountry();
      const area = code ? await countryArea(code) : null;
      setBusy(false);
      if (!area) {
        showHint(askAgain(problem, 'plan'));
        return;
      }
      start({ kind: 'area', bounds: area.bounds }, area.name, { title: `Routes in ${area.name}`, text: note(area.name), retry: null });
    };
    locate(
      NEAR_ME_OPTIONS,
      (here) => {
        const at: RunWhere = { kind: 'point', ...here };
        if (matchRoutes(routes, needsFor(at)).reachM != null) {
          setBusy(false);
          start(at, 'Near you', null);
          return;
        }
        const widest = formatRadius(NEAR_ME_RADII_M[NEAR_ME_RADII_M.length - 1], units);
        void inCountry((country) => `No routes within ${widest} of you. Ranking routes in ${country}.`, `No routes within ${widest} of you.`);
      },
      (problem) => {
        const text = locationProblemText(problem, 'Allow location to rank routes near you.');
        void inCountry((country) => `${text} Ranking routes in ${country} instead.`, text);
      },
    );
  }, [ready, routes, units, showHint, start]);

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
    whereLabel: where?.label ?? null,
    busy,
    ranking,
    listedRoutes,
    plan,
    clear,
    noteOpened,
  };
}
