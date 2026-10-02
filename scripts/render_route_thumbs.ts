/**
 * Render and store one basemap image per committed route, so route cards show
 * the real terrain under the trace without the browser rendering a map per
 * card. Uses the same OpenFreeMap style as the live map (no key, no account).
 *
 *   node scripts/render_route_thumbs.ts            # only missing or stale images
 *   node scripts/render_route_thumbs.ts --force    # re-render everything
 *
 * Reads public/data/routes.json (run build_data.py first) and writes
 * public/route-thumbs/<slug>-<view>.jpg. Old images for a slug are removed.
 */
import { createServer } from 'node:http';
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { THUMB_H, THUMB_W, thumbPath, thumbView } from '../src/lib/thumbView.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maplibreDist = join(root, 'node_modules/maplibre-gl/dist');
const outDir = join(root, 'public/route-thumbs');
const styleUrl = readFileSync(join(root, 'src/map/constants.ts'), 'utf8').match(/'(https:[^']+)'/)?.[1];
const force = process.argv.includes('--force');

interface RouteJson {
  slug: string;
  coordinates: [number, number, number][];
}

const { routes } = JSON.parse(readFileSync(join(root, 'public/data/routes.json'), 'utf8')) as { routes: RouteJson[] };
if (!styleUrl) throw new Error('MAP_STYLE_URL not found in src/map/constants.ts');
mkdirSync(outDir, { recursive: true });

const page = `<!doctype html><html><head><link rel="stylesheet" href="/maplibre-gl.css">
<style>html,body{margin:0}#map{width:${THUMB_W}px;height:${THUMB_H}px}</style></head>
<body><div id="map"></div><script type="module">
import { Map } from '/maplibre-gl.mjs';
const map = new Map({ container: 'map', style: ${JSON.stringify(styleUrl)}, center: [0, 0], zoom: 1,
  interactive: false, attributionControl: false, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true } });
window.showView = (centre, zoom) => new Promise((done) => { map.once('idle', done); map.jumpTo({ center: centre, zoom }); map.triggerRepaint(); });
map.once('style.load', () => {
  // Labels fight the trace at card size; hillshade is what shows the terrain.
  for (const layer of map.getStyle().layers) if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
  map.addSource('terrain', { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] });
  const beneath = map.getStyle().layers.find((layer) => layer.type === 'line')?.id;
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'terrain',
    paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#5a6b52', 'hillshade-highlight-color': '#ffffff' } }, beneath);
  map.once('idle', () => { window.mapReady = true; });
});
</script></body></html>`;

const types: Record<string, string> = { '.mjs': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const server = createServer((req, res) => {
  const name = (req.url ?? '/').split('?')[0];
  if (name === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  const file = join(maplibreDist, name.replace(/^\/+/, ''));
  if (!file.startsWith(maplibreDist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const tab = await browser.newPage({ viewport: { width: THUMB_W, height: THUMB_H }, deviceScaleFactor: 2 });
  tab.on('pageerror', (error) => console.error('[page]', error.message));
  tab.on('console', (message) => message.type() === 'error' && console.error('[page]', message.text()));
  await tab.goto(`http://127.0.0.1:${port}/`);
  await tab.waitForFunction(() => (window as unknown as { mapReady?: boolean }).mapReady, null, { timeout: 60_000 });

  let rendered = 0;
  for (const route of routes) {
    const view = thumbView(route.coordinates);
    if (!view) continue;
    const target = join(root, 'public', thumbPath(route.slug, view));
    if (!force && existsSync(target)) continue;
    await tab.evaluate(
      ([centre, zoom]) => (window as unknown as { showView: (c: number[], z: number) => Promise<void> }).showView(centre, zoom),
      [view.centre, view.zoom] as [number[], number],
    );
    const image = await tab.locator('#map').screenshot({ type: 'jpeg', quality: 78 });
    const stale = new RegExp(`^${route.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9a-z]+\\.jpg$`);
    for (const old of readdirSync(outDir)) {
      if (stale.test(old) && join(outDir, old) !== target) rmSync(join(outDir, old));
    }
    writeFileSync(target, image);
    rendered += 1;
    console.log(`rendered ${route.slug} → ${thumbPath(route.slug, view)}`);
  }
  console.log(`${rendered} rendered, ${routes.length - rendered} already up to date`);
} finally {
  await browser.close();
  server.close();
}
