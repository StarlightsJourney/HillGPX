import { saveFile } from '../lib/dom';
import { useSavedPlaces, useSavedRoutes } from '../lib/saved';
import { nameFromSlug, useSavedDetails } from '../lib/savedDetails';
import { ArchiveIcon, DownloadIcon } from './icons';

/** Settings › Your data: what can be taken out, and how the open archive works. */
export function SettingsData() {
  const routes = useSavedRoutes();
  const places = useSavedPlaces();
  const details = useSavedDetails(routes, places);
  const empty = routes.size + places.size === 0;

  const download = () => {
    const list = {
      exportedAt: new Date().toISOString(),
      routes: [...routes].map((slug) => ({ slug, name: details.routes.get(slug)?.name ?? nameFromSlug(slug) })),
      places: [...places].map((slug) => ({ slug, name: details.places.get(slug)?.name ?? nameFromSlug(slug) })),
    };
    saveFile(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }), 'hillgpx-saved.json');
  };

  return (
    <>
      <section className="ac-card" aria-labelledby="ac-saved-export">
        <h3 id="ac-saved-export">Your saved list</h3>
        <p className="ac-help">
          {empty ? 'Nothing saved yet.' : `${routes.size} saved ${routes.size === 1 ? 'route' : 'routes'} and ${places.size} saved ${places.size === 1 ? 'place' : 'places'}, as a JSON file.`}
        </p>
        <button type="button" className="ac-btn soft" disabled={empty || !details.ready} onClick={download}>
          <DownloadIcon size={16} /> Download your saved list
        </button>
      </section>
      <section className="ac-note-card">
        <ArchiveIcon />
        <p>Published routes are public and stay available to everyone, even after you delete your account.</p>
      </section>
    </>
  );
}
