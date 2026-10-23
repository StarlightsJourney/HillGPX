/**
 * GET /api/country — the visitor's country as Cloudflare reads it from the
 * connection (an ISO 3166 alpha-2 code, or null), for "Routes near me" when
 * location is not shared. Cloudflare Pages runs this from the functions/
 * folder; nothing is logged or stored, and the answer is never cached, since
 * it differs per visitor. Off Cloudflare the app falls back to the device's
 * time zone (src/lib/country.ts).
 */
export function onRequestGet({ request }) {
  const country = request.cf?.country ?? null;
  return new Response(JSON.stringify({ country }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
  });
}
