import { accountHref, type SavedTab } from '../lib/accountRoute';
import { openMapWith } from '../lib/mapIntent';
import { useSavedPlaces, useSavedRoutes } from '../lib/saved';
import { nameFromSlug, useSavedDetails } from '../lib/savedDetails';
import { venueHeight } from '../lib/venues';
import { LinkTabs, Panel } from './AccountParts';
import { useUnits } from './UnitsContext';
import { ArrowLeftIcon, HeartIcon } from './icons';

interface RowSpec {
  slug: string;
  name: string;
  meta: string;
  open: () => void;
}

/** Panel: Saved. Routes and places saved to the account; each opens on the map. */
export function AccountSaved({ tab }: { tab: SavedTab }) {
  const units = useUnits();
  const routeSlugs = useSavedRoutes();
  const placeSlugs = useSavedPlaces();
  const details = useSavedDetails(routeSlugs, placeSlugs);

  const routeRows: RowSpec[] = [...routeSlugs].map((slug) => {
    const route = details.routes.get(slug);
    return {
      slug,
      name: route?.name ?? nameFromSlug(slug),
      meta: route ? `Route · ${units.distance(route.distanceM)} · +${units.height(route.gainM)}` : 'Route',
      open: () => openMapWith({ kind: 'route', slug }),
    };
  });
  const placeRows: RowSpec[] = [...placeSlugs].map((slug) => {
    const venue = details.places.get(slug);
    const height = venue ? venueHeight(venue) : null;
    return {
      slug,
      name: venue?.name ?? nameFromSlug(slug),
      meta: height ? `Place · ${units.height(height.value)}` : 'Place',
      open: () => openMapWith({ kind: 'venue', slug }),
    };
  });
  const rows = tab === 'routes' ? routeRows : placeRows;
  const total = routeRows.length + placeRows.length;

  return (
    <Panel labelledBy="ac-saved-h">
      <div className="ac-panel-head">
        <a className="ac-back" href={accountHref.routes} aria-label="Back to your routes">
          <ArrowLeftIcon size={20} />
        </a>
        <h2 className="ac-h2" id="ac-saved-h">
          Saved
        </h2>
      </div>
      <LinkTabs
        label="Saved views"
        current={tab}
        tabs={[
          { id: 'routes', label: `Routes (${routeRows.length})`, href: accountHref.saved('routes') },
          { id: 'places', label: `Places (${placeRows.length})`, href: accountHref.saved('places') },
        ]}
      />
      <p className="ac-quiet">Saved to your account and synced to every device you sign in on.</p>

      {total === 0 ? (
        <div className="ac-empty">
          <p className="ac-empty-line">Nothing saved yet. Tap the heart on a route or place on the map to keep it here.</p>
          <a className="ac-btn primary" href="#map">
            Explore the map
          </a>
        </div>
      ) : rows.length === 0 ? (
        <p className="ac-quiet">No saved {tab} yet.</p>
      ) : (
        <ul className="ac-rows" aria-busy={!details.ready}>
          {rows.map((row) => (
            <li key={row.slug} className="ac-row">
              <span className="ac-heart" aria-hidden="true">
                <HeartIcon size={18} filled />
              </span>
              <span className="ac-row-text">
                <strong>{row.name}</strong>
                <small>{row.meta}</small>
              </span>
              <button type="button" className="ac-btn soft sm" onClick={row.open} aria-label={`Open ${row.name} on map`}>
                Open on map
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
