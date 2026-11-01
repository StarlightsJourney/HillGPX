/* global Response, fetch, AbortSignal */
/**
 * POST /api/moderate — screens contribution text and images through OpenAI's
 * moderation model so abusive content is never stored.
 *
 * Two callers use it:
 *   * the browser, before it publishes, so an honest contributor is refused
 *     instantly instead of uploading first (src/lib/moderate.ts), and
 *   * the database's moderation_gate trigger on every insert and on edits of
 *     screened fields — the enforcement half, so a crafted API write cannot
 *     skip the check (supabase/migrations/*_ai_moderation.sql).
 *
 * Body:   { inputs: [{type:'text',text} | {type:'image',url|base64}] }
 * Answer: { flagged, categories, results: [{flagged,categories}, ...] } —
 *         one result per input, in order, so a caller can say which field
 *         was refused.
 *
 * OPENAI_API_KEY is a Pages secret (Settings → Variables and Secrets;
 * .dev.vars for `wrangler pages dev`). The moderation endpoint is free and
 * does not count toward billing, but the key's rate limits still apply, so
 * pair this with a Cloudflare rate-limit rule on /api/moderate — it is open
 * by design (the browser calls it and cannot hold a secret).
 */
const UPSTREAM = 'https://api.openai.com/v1/moderations';
const MODEL = 'omni-moderation-latest';
// Only ever fetch images from our own storage; anything else would make this
// an open fetch proxy.
const IMAGE_URL_PREFIX = 'https://dzpgnebkyubeptitzjlj.supabase.co/storage/v1/object/public/';
const MAX_INPUTS = 8;
const MAX_TEXT = 4000;
const MAX_BASE64 = 6 * 1024 * 1024; // ~4.5 MB of image
const UPSTREAM_TIMEOUT_MS = 10_000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) return json(503, { error: 'not_configured' });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }
  const inputs = body?.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_INPUTS) {
    return json(400, { error: 'bad_inputs' });
  }

  const oaiInput = [];
  for (const item of inputs) {
    if (item?.type === 'text' && typeof item.text === 'string' && item.text.length <= MAX_TEXT) {
      oaiInput.push({ type: 'text', text: item.text });
      continue;
    }
    if (item?.type === 'image') {
      const url =
        typeof item.url === 'string' && item.url.startsWith(IMAGE_URL_PREFIX)
          ? item.url
          : typeof item.base64 === 'string' && item.base64.length <= MAX_BASE64
            ? `data:image/jpeg;base64,${item.base64}`
            : null;
      if (!url) return json(400, { error: 'bad_image' });
      oaiInput.push({ type: 'image_url', image_url: { url } });
      continue;
    }
    return json(400, { error: 'bad_inputs' });
  }

  let data;
  try {
    const response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, input: oaiInput }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return json(502, { error: 'upstream' });
    data = await response.json();
  } catch {
    return json(502, { error: 'upstream' });
  }

  const results = (data.results ?? []).map((result) => ({
    flagged: Boolean(result.flagged),
    categories: Object.entries(result.categories ?? {})
      .filter(([, hit]) => hit)
      .map(([name]) => name),
  }));
  // A short result list is treated as unflagged rather than dropping the call.
  while (results.length < oaiInput.length) results.push({ flagged: false, categories: [] });
  return json(200, {
    flagged: results.some((result) => result.flagged),
    categories: [...new Set(results.flatMap((result) => result.categories))],
    results,
  });
}
