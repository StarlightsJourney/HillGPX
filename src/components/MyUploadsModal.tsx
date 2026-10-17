import { useEffect, useState } from 'react';
import { deleteMyRoute, fetchMyRoutes, type MyUpload } from '../lib/auth';
import type { RouteActivity } from '../types';
import { ActivityIcon } from './ActivityIcon';
import { Modal } from './Modal';
import { useUnits } from './UnitsContext';

/**
 * The signed-in user's published GPX uploads (routes stamped with their id
 * at publish time). Each row links straight to the downloadable file.
 */
export function UploadsList() {
  const units = useUnits();
  const [routes, setRoutes] = useState<MyUpload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = async (slug: string) => {
    setDeleting(slug);
    setError(null);
    try {
      await deleteMyRoute(slug);
      setRoutes((rows) => rows?.filter((route) => route.slug !== slug) ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchMyRoutes()
      .then((rows) => !cancelled && setRoutes(rows))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {error && <p className="review-error">{error}</p>}
      {!routes && !error && <p className="profile-note">Loading…</p>}
      {routes && routes.length === 0 && (
        <div className="uploads-empty">
          <p className="profile-note">
            Nothing published yet. Routes you share through <strong>Add a GPX</strong> while signed in show up here,
            ready to download again.
          </p>
        </div>
      )}
      {routes && routes.length > 0 && (
        <ul className="uploads-list">
          {routes.map((route) => (
            <li key={route.slug} className="uploads-row">
              <span className="uploads-icon">
                <ActivityIcon activity={route.activity as RouteActivity} size={16} />
              </span>
              <span className="uploads-info">
                <strong>{route.name}</strong>
                <small>
                  {units.distance(route.distanceM)} · {units.height(route.gainM)} EG ·{' '}
                  {route.downloads} {route.downloads === 1 ? 'download' : 'downloads'} ·{' '}
                  {new Date(route.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </small>
              </span>
              <a
                className="btn btn-light btn-sm"
                href="#routes"
                onClick={() => sessionStorage.setItem('hillgpx:pendingRoute', route.slug)}
              >
                View
              </a>
              <a className="btn btn-light btn-sm" href={route.gpxUrl} download={`${route.slug}.gpx`}>
                GPX
              </a>
              {confirming === route.slug ? (
                <span className="uploads-confirm">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={deleting === route.slug}
                    onClick={() => void remove(route.slug)}
                  >
                    {deleting === route.slug ? 'Deleting…' : 'Delete?'}
                  </button>
                  <button type="button" className="profile-link" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="profile-link danger uploads-remove" onClick={() => setConfirming(route.slug)}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function MyUploadsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="My uploads" onClose={onClose} wide>
      <UploadsList />
    </Modal>
  );
}
