/* global Response, URL, fetch */
/**
 * GET /api/ghealth — same-origin relay for Google Health reads.
 *
 * Some visitor networks and browser blockers refuse direct calls to
 * googleapis.com; the app then falls back to this Cloudflare Pages function
 * (see src/lib/googleHealth.ts healthGet — it is the last resort after fetch
 * and XMLHttpRequest). Only the two reads the import dialog needs are
 * forwarded; the caller's Google access token passes through verbatim and is
 * never stored or logged. The upstream status, body and content-type come
 * back untouched, marked X-GHealth-Proxy so the app can tell a real relay
 * answer from a static-host 404 or the dev server's index.html.
 */
const UPSTREAM = 'https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints';
const TCX_ID = /^[A-Za-z0-9_-]{1,128}$/;

const json = (status, error) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-GHealth-Proxy': '1' },
  });

export async function onRequestGet({ request }) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json(401, 'missing_token');

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id') ?? '';
  let upstream;
  if (kind === 'workouts') upstream = `${UPSTREAM}?page_size=50`;
  else if (kind === 'tcx' && TCX_ID.test(id)) upstream = `${UPSTREAM}/${id}:exportExerciseTcx?alt=media`;
  else return json(400, 'unknown_request');

  try {
    const response = await fetch(upstream, { headers: { Authorization: auth } });
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-GHealth-Proxy': '1',
      },
    });
  } catch {
    return json(502, 'upstream_failed');
  }
}
