/* global Response, fetch, URLSearchParams, console */
/**
 * hillgpx-autoban: bans addresses that probe hillgpx.com for secrets.
 *
 * Cloudflare's firewall on hillgpx.com blocks requests for .env, .git, .php,
 * WordPress paths and similar (custom rule "Secret and exploit probes").
 * Every five minutes this Worker (a Cron Trigger, no route) reads that rule's
 * firewall events and bans each probing address from the whole site with a
 * zone IP Access Rule (mode "block"), noted "hillgpx-autoban". Bans are lifted
 * after BAN_DAYS so a recycled address is not banned forever. IPv6 addresses
 * are banned as their /64, since one machine usually holds a whole /64.
 *
 * (The custom rule "Banned addresses" and the IP list `hillgpx_banned` are
 * for bans added by hand; this Worker does not touch them.)
 *
 * Settings (Worker → Settings → Variables and Secrets):
 *   CF_API_TOKEN  secret. An API token with Zone · Firewall Services · Edit
 *                 and Zone · Analytics · Read. Without it the Worker does
 *                 nothing.
 *   ZONE_ID, PROBE_RULE_ID  plain text (set at deploy).
 *   NEVER_BAN     comma-separated addresses or prefixes that are never banned
 *                 (the maintainer's own connection, for testing).
 *   BAN_DAYS      how long a ban lasts (default 30).
 *
 * Deployed through the Cloudflare API (see AGENTS.md "Auto-ban"); this file
 * is the source of truth for what runs.
 */

const API = 'https://api.cloudflare.com/client/v4';
const LOOKBACK_MINUTES = 15;
const NOTE = 'hillgpx-autoban';

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

/** The IP Access Rule target for an address: itself for IPv4, its /64 for IPv6. */
function banTarget(ip) {
  if (!ip.includes(':')) return { target: 'ip', value: ip };
  return { target: 'ip_range', value: `${expandIpv6(ip).slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64` };
}

/** Every ban this Worker has made (rules noted "hillgpx-autoban"). */
async function ourBans(env) {
  const rules = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ notes: NOTE, per_page: '1000', page: String(page) });
    const body = await api(env, `/zones/${env.ZONE_ID}/firewall/access_rules/rules?${query}`);
    rules.push(...body.result);
    if (page >= (body.result_info?.total_pages ?? 1)) break;
  }
  return rules;
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

  const existing = await ourBans(env);
  const banned = new Set(existing.map((rule) => rule.configuration?.value));
  let added = 0;
  for (const probe of probes) {
    if (neverBan.some((safe) => probe.clientIP === safe || probe.clientIP.startsWith(safe))) continue;
    const configuration = banTarget(probe.clientIP);
    if (banned.has(configuration.value)) continue;
    banned.add(configuration.value);
    await api(env, `/zones/${env.ZONE_ID}/firewall/access_rules/rules`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'block', configuration, notes: `${NOTE}: probed ${probe.clientRequestPath.slice(0, 100)} on ${probe.datetime.slice(0, 10)}` }),
    });
    added++;
  }

  // Lift bans older than BAN_DAYS.
  const cutoff = Date.now() - banDays * 24 * 3600 * 1000;
  const expired = existing.filter((rule) => Date.parse(rule.created_on) < cutoff);
  for (const rule of expired) {
    await api(env, `/zones/${env.ZONE_ID}/firewall/access_rules/rules/${rule.id}`, { method: 'DELETE' });
  }
  console.log(`autoban: ${probes.length} probe events, ${added} new bans, ${expired.length} expired`);
}
