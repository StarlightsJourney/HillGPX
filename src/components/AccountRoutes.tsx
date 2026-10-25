import { useMemo, useState } from 'react';
import { errorText } from '../lib/api';
import { deleteMyRoute, type AuthUser, type MyUpload } from '../lib/auth';
import { openImportHere, REPO_URL } from '../lib/contribute';
import { openMapWith } from '../lib/mapIntent';
import { forgetMyRoute } from '../lib/myRoutes';
import type { RouteActivity } from '../types';
import { ActivityIcon } from './ActivityIcon';
import { ContourArt, formatShortDate, Panel, pluralise, UnitsSwitch } from './AccountParts';
import { useUnits } from './UnitsContext';
import { ChevronRightIcon, HeartIcon, TrashIcon, UploadIcon } from './icons';

type Sort = 'newest' | 'downloads';

interface Props {
  user: AuthUser;
  routes: MyUpload[] | null;
  error: string | null;
  onRetry: () => void;
}

/** Panel: Your routes. */
export function AccountRoutes({ user, routes, error, onRetry }: Props) {
  const units = useUnits();
  const [sort, setSort] = useState<Sort>('newest');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!routes) return null;
    const rows = [...routes];
    if (sort === 'downloads') rows.sort((a, b) => b.downloads - a.downloads || b.createdAt.localeCompare(a.createdAt));
    else rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }, [routes, sort]);

  const remove = async (slug: string) => {
    setDeleting(slug);
    setDeleteError(null);
    try {
      await deleteMyRoute(slug);
      forgetMyRoute(slug);
    } catch (err) {
      setDeleteError(errorText(err));
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  };

  if (error) {
    return (
      <Panel>
        <h2 className="ac-h2">Your routes</h2>
        <div className="ac-error" role="alert">
          <p>{error}</p>
          <button type="button" className="ac-btn soft" onClick={onRetry}>
            Try again
          </button>
        </div>
      </Panel>
    );
  }

  if (!sorted) {
    return (
      <Panel>
        <h2 className="ac-h2">Your routes</h2>
        <div className="ac-list-skel" role="status" aria-label="Loading your routes">
          {[0, 1, 2].map((n) => (
            <span key={n} className="ac-skel" aria-hidden="true" />
          ))}
        </div>
      </Panel>
    );
  }

  if (sorted.length === 0) return <EmptyRoutes user={user} />;

  return (
    <Panel labelledBy="ac-routes-h">
      <div className="ac-panel-head">
        <h2 className="ac-h2" id="ac-routes-h">
          Your routes
        </h2>
        <div className="ac-seg" role="group" aria-label="Sort routes">
          <button type="button" aria-pressed={sort === 'newest'} className={sort === 'newest' ? 'on' : ''} onClick={() => setSort('newest')}>
            Newest
          </button>
          <button type="button" aria-pressed={sort === 'downloads'} className={sort === 'downloads' ? 'on' : ''} onClick={() => setSort('downloads')}>
            Most downloaded
          </button>
        </div>
      </div>

      {deleteError && (
        <p className="ac-field-error" role="alert">
          {deleteError}
        </p>
      )}

      <ul className="ac-rows">
        {sorted.map((route) => (
          <li key={route.slug} className="ac-row">
            <button type="button" className="ac-row-main" onClick={() => openMapWith({ kind: 'route', slug: route.slug })}>
              <span className="ac-thumb">
                <ActivityIcon activity={route.activity as RouteActivity} size={20} />
              </span>
              <span className="ac-row-text">
                <strong>{route.name}</strong>
                <small>
                  {units.distance(route.distanceM)} · Uploaded {formatShortDate(route.createdAt)}
                  {route.anonymous ? ' · anonymous' : ''}
                </small>
              </span>
              <span className="ac-chip tint">+{units.height(route.gainM)} gain</span>
              <span className="ac-chip">{pluralise(route.downloads, 'download', 'downloads')}</span>
              <ChevronRightIcon size={16} />
              <span className="sr-only">Open {route.name} on the map</span>
            </button>
            {confirming === route.slug ? (
              <span className="ac-row-confirm">
                <button type="button" className="ac-btn danger sm" disabled={deleting === route.slug} onClick={() => void remove(route.slug)}>
                  {deleting === route.slug ? 'Deleting…' : 'Delete route'}
                </button>
                <button type="button" className="ac-link" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="ac-icon-btn quiet" aria-label={`Delete ${route.name}`} onClick={() => setConfirming(route.slug)}>
                <TrashIcon size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>

      <footer className="ac-note">
        <p>
          Public in the open archive, credited to @{user.username}. They stay even if you delete your account.{' '}
          <a href={`${REPO_URL}/blob/HEAD/docs/COMMUNITY.md`} target="_blank" rel="noreferrer">
            How the archive works
          </a>
        </p>
      </footer>
    </Panel>
  );
}

function EmptyRoutes({ user }: { user: AuthUser }) {
  return (
    <>
      <section className="ac-panel ac-hero-card" aria-labelledby="ac-empty-h">
        <ContourArt className="ac-hero-art" />
        <h2 className="ac-h2" id="ac-empty-h">
          Your first climb is waiting
        </h2>
        <p>
          Upload a GPX file and it goes on the map for everyone, credited to @{user.username}. Its downloads and elevation gain show up here.
        </p>
        <div className="ac-actions">
          <a className="ac-btn primary" href="#import" onClick={openImportHere}>
            <UploadIcon size={16} /> Upload a GPX file
          </a>
          <a className="ac-btn soft" href="#map">
            Explore climbs
          </a>
        </div>
      </section>
      <div className="ac-pair">
        <section className="ac-card-sm" aria-labelledby="ac-save-h">
          <span className="ac-card-icon">
            <HeartIcon size={20} />
          </span>
          <h3 id="ac-save-h">Save climbs you want to ride</h3>
          <p>Tap the heart on any route. Saves sync to your account.</p>
          <a className="ac-btn soft" href="#map">
            Find a climb
          </a>
        </section>
        <section className="ac-card-sm" aria-labelledby="ac-units-h">
          <h3 id="ac-units-h">Metres or feet?</h3>
          <p>Every number in your account follows this.</p>
          <UnitsSwitch />
        </section>
      </div>
    </>
  );
}

