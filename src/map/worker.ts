import { setWorkerUrl } from 'maplibre-gl';
// `?worker&url` makes Vite bundle the worker (with the shared chunk it imports)
// into dist/ and hand back its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// MapLibre 6 finds its worker next to its own module via import.meta.url. That
// works in dev (Vite serves node_modules) but the production bundle has no such
// file, so on GitHub Pages the worker 404s and the map never draws. Import this
// module before creating any Map.
setWorkerUrl(workerUrl);
