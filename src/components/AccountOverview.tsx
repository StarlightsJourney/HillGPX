import { useMemo } from 'react';
import type { AuthUser, MyUpload } from '../lib/auth';
import { openImportHere } from '../lib/contribute';
import { loadFavorites } from '../lib/venues';
import { useRouteBookmarks } from '../lib/useRouteBookmarks';
import type { RouteActivity } from '../types';
import { ActivityIcon } from './ActivityIcon';
import { CheckIcon, HeartIcon, UploadIcon } from './icons';
import { Avatar } from './ProfileModal';
import { useUnits } from './UnitsContext';

/** Rows shown here; the rest, and deleting, live on the My uploads page. */
const ROUTES_SHOWN = 4;

/** A few nested contour rings, drawn once and kept faint behind the name. */
function ContourBackdrop() {
  return (
    <svg className="acct-contours" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M330 100c10-52 80-84 150-74 62 9 104 52 96 98-8 48-64 78-128 72-52-5-82-30-118-96z" />
        <path d="M368 102c8-34 54-54 100-48 42 6 70 34 64 64-6 32-44 52-88 48-36-3-58-20-76-64z" />
        <path d="M404 104c6-20 34-32 62-28 26 4 44 20 40 40-4 20-28 32-54 30-22-2-36-12-48-42z" />
        <path d="M438 106c4-10 18-16 32-14 14 2 22 10 20 20-3 10-15 16-28 15-11-1-18-6-24-21z" />
        <path d="M250 180c30-18 66-14 92 8" />
        <path d="M200 150c46-30 100-26 140 10" />
      </g>
    </svg>
  );
}

function memberSince(createdAt: string): string | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

interface OverviewProps {
  user: AuthUser;
  /** null while loading; an error leaves it null and sets `error`. */
  routes: MyUpload[] | null;
  error: string | null;
}

/**
 * The top of the account page: who you are, what you have shared, and the way
 * back into your routes. This is what most visits are for, so it comes before
 * any settings.
 */
export function AccountOverview({ user, routes, error }: OverviewProps) {
  const units = useUnits();
  const since = memberSince(user.createdAt);
  const methods = user.providers.includes('google') ? 'Google' : 'Email';

  const totals = useMemo(() => {
    if (!routes) return null;
    return {
      count: routes.length,
      downloads: routes.reduce((sum, route) => sum + route.downloads, 0),
      gainM: routes.reduce((sum, route) => sum + route.gainM, 0),
    };
  }, [routes]);

  // Saved items are only kept in this browser, so the card says so.
  const savedRoutes = useRouteBookmarks().size;
  const savedPlaces = useMemo(() => loadFavorites().size, []);

  return (
    <>
      <section className="acct-identity" aria-labelledby="acct-name">
        <ContourBackdrop />
        <div className="acct-identity-main">
          <Avatar url={user.avatarUrl} username={user.username} size={72} />
          <div className="acct-identity-text">
            <h1 id="acct-name">{user.username}</h1>
            <p>
              {since ? `Member since ${since}` : 'Member'}
              <span className="acct-status acct-status-chip">
                <CheckIcon size={12} /> Signed in with {methods}
              </span>
            </p>
          </div>
        </div>
        <dl className="acct-stats">
          <div>
            <dt>Routes shared</dt>
            <dd>{totals ? totals.count : '–'}</dd>
          </div>
          <div>
            <dt>Downloads</dt>
            <dd>{totals ? totals.downloads.toLocaleString() : '–'}</dd>
          </div>
          <div>
            <dt>Total EG</dt>
            <dd>{totals ? units.height(totals.gainM) : '–'}</dd>
          </div>
        </dl>
      </section>

      <section className="acct-section" aria-labelledby="acct-routes-title">
        <div className="acct-section-head">
          <h2 id="acct-routes-title">Your routes</h2>
          {routes && routes.length > 0 && (
            <a className="acct-more" href="#uploads">
              {routes.length > ROUTES_SHOWN ? `See all ${routes.length}` : 'Manage'}
            </a>
          )}
        </div>

        {error && (
          <p className="review-error" role="alert">
            {error}
          </p>
        )}
        {!routes && !error && <p className="acct-hint">Loading your routes…</p>}

        {routes && routes.length === 0 && (
          <div className="acct-empty">
            <p>
              Routes you publish while signed in appear here with their download counts, ready to fetch again.
            </p>
            <a className="btn btn-dark btn-sm" href="#import" onClick={openImportHere}>
              <UploadIcon size={14} /> Upload your first GPX route
            </a>
          </div>
        )}

        {routes && routes.length > 0 && (
          <ul className="acct-routes">
            {routes.slice(0, ROUTES_SHOWN).map((route) => (
              <li key={route.slug}>
                <span className="uploads-icon">
                  <ActivityIcon activity={route.activity as RouteActivity} size={16} />
                </span>
                <span className="uploads-info">
                  <strong>{route.name}</strong>
                  <small>
                    {units.distance(route.distanceM)} · {units.height(route.gainM)} EG · {route.downloads}{' '}
                    {route.downloads === 1 ? 'download' : 'downloads'}
                    {route.anonymous ? ' · anonymous' : ''}
                  </small>
                </span>
                <a
                  className="btn btn-light btn-sm"
                  href="#routes"
                  onClick={() => sessionStorage.setItem('hillgpx:pendingRoute', route.slug)}
                >
                  View
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="acct-section" aria-labelledby="acct-saved-title">
        <div className="acct-section-head">
          <h2 id="acct-saved-title">Saved on this device</h2>
        </div>
        {savedRoutes + savedPlaces === 0 ? (
          <p className="acct-hint">
            Tap the heart on a route or place to keep it here. Saved items stay in this browser and do not follow you
            to other devices.
          </p>
        ) : (
          <div className="acct-saved">
            <span className="acct-saved-icon">
              <HeartIcon size={16} filled />
            </span>
            <p>
              {savedRoutes} {savedRoutes === 1 ? 'route' : 'routes'} · {savedPlaces}{' '}
              {savedPlaces === 1 ? 'place' : 'places'}
              <small>Find them under Saved on the map. They stay in this browser and do not follow you to other devices.</small>
            </p>
            <a className="btn btn-light btn-sm" href="#routes">
              Open map
            </a>
          </div>
        )}
      </section>
    </>
  );
}
