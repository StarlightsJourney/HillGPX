/* global Response, fetch, URLSearchParams, console */
/**
 * hillgpx-autoban: bans addresses that probe hillgpx.com for secrets.
 *
 * Cloudflare's firewall on hillgpx.com has two custom rules:
 *   1. "Banned addresses": block every request from the IP list
 *      `hillgpx_banned` (the whole site, including the app and its data).
 *   2. "Secret and exploit probes": block requests for .env, .git, .php,
 *      WordPress paths and similar.
 *
 * Every five minutes this Worker (a Cron Trigger, no route) reads the
 * firewall events for rule 2 and adds each probing address to the list, so
 * from then on rule 1 keeps it out of everything. Entries expire after
 * BAN_DAYS so a recycled address is not banned forever. IPv6 addresses are
 * banned as their /64, since one machine usually holds a whole /64.
 *
 * Settings (Worker → Settings → Variables and Secrets):
 *   CF_API_TOKEN  secret. An API token with "Account · Account Filter Lists ·
 *                 Edit" and "Zone · Analytics · Read" (hillgpx.com). Without
 *                 it the Worker does nothing.
 *   ACCOUNT_ID, ZONE_ID, LIST_ID, PROBE_RULE_ID  plain text (set at deploy).
 *   NEVER_BAN     comma-separated addresses or prefixes that are never added
 *                 (the maintainer's own connection, for testing).
 *   BAN_DAYS      how long a ban lasts (default 30).
 *
 * Deployed through the Cloudflare API (see AGENTS.md "Auto-ban"); this file
 * is the source of truth for what runs.
 */

const API = 'https://api.cloudflare.com/client/v4';
const LOOKBACK_MINUTES = 15;

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // No route points here; anything that reaches it gets nothing.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};

async function api(env, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json();
  if (!body.success && !body.data) throw new Error(`${path}: ${JSON.stringify(body.errors ?? body)}`);
  return body;
}

/** Full eight-group form of an IPv6 address, so its /64 can be cut off. */
function expandIpv6(ip) {
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const middle = ip.includes('::') ? Array(8 - left.length - right.length).fill('0') : [];
  return [...left, ...middle, ...right].map((group) => group.padStart(4, '0'));
}

/** What goes on the list for an address: itself for IPv4, its /64 for IPv6. */
function banTarget(ip) {
  if (!ip.includes(':')) return ip;
  return `${expandIpv6(ip).slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

async function listItems(env) {
  const items = [];
  let cursor;
  do {
    const query = new URLSearchParams({ per_page: '500', ...(cursor ? { cursor } : {}) });
    const page = await api(env, `/accounts/${env.ACCOUNT_ID}/rules/lists/${env.LIST_ID}/items?${query}`);
    items.push(...page.result);
    cursor = page.result_info?.cursors?.after;
  } while (cursor);
  return items;
}

async function run(env) {
  if (!env.CF_API_TOKEN) return;
  const neverBan = String(env.NEVER_BAN ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const banDays = Number(env.BAN_DAYS) || 30;

  // Who tripped the probe rule recently.
  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const query = `query($zone: String!, $since: Time!, $rule: String!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      firewallEventsAdaptive(limit: 1000, filter: { datetime_geq: $since, ruleId: $rule }) { clientIP clientRequestPath datetime }
    } }
  }`;
  const events = await api(env, '/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables: { zone: env.ZONE_ID, since, rule: env.PROBE_RULE_ID } }),
  });
  const probes = events.data?.viewer?.zones?.[0]?.firewallEventsAdaptive ?? [];

  const existing = await listItems(env);
  const listed = new Set(existing.map((item) => item.ip));
  const additions = new Map();
  for (const probe of probes) {
    if (neverBan.some((safe) => probe.clientIP === safe || probe.clientIP.startsWith(safe))) continue;
    const target = banTarget(probe.clientIP);
    if (listed.has(target) || additions.has(target)) continue;
    additions.set(target, { ip: target, comment: `Probed ${probe.clientRequestPath.slice(0, 120)} on ${probe.datetime.slice(0, 10)}` });
  }
  if (additions.size > 0) {
    await api(env, `/accounts/${env.ACCOUNT_ID}/rules/lists/${env.LIST_ID}/items`, { method: 'POST', body: JSON.stringify([...additions.values()]) });
  }

  // Lift bans older than BAN_DAYS.
  const cutoff = Date.now() - banDays * 24 * 3600 * 1000;
  const expired = existing.filter((item) => Date.parse(item.created_on) < cutoff).map((item) => ({ id: item.id }));
  if (expired.length > 0) {
    await api(env, `/accounts/${env.ACCOUNT_ID}/rules/lists/${env.LIST_ID}/items`, { method: 'DELETE', body: JSON.stringify({ items: expired }) });
  }
  console.log(`autoban: ${probes.length} probe events, ${additions.size} new bans, ${expired.length} expired`);
}
