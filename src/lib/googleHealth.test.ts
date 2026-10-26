import { beforeEach, describe, expect, it, vi } from 'vitest';

type TokenResult = { access_token?: string; scope?: string; expires_in?: number; error?: string };
type Step = TokenResult | { popup: string };

/** A controllable Google Identity Services fake: queue the token responses
 *  each requestAccessToken should answer and watch revoke calls. */
const gis = vi.hoisted(() => {
  const state = {
    loadGis: vi.fn(),
    queue: [] as Step[],
    prompts: [] as (string | undefined)[],
    revoked: [] as string[],
    revokeResponse: { successful: true } as { successful?: boolean; error?: string },
    google: {
      accounts: {
        id: {},
        oauth2: {
          initTokenClient(config: {
            callback: (response: TokenResult) => void;
            error_callback?: (error: { type?: string }) => void;
          }) {
            return {
              requestAccessToken(overrides?: { prompt?: string }) {
                state.prompts.push(overrides?.prompt);
                const step = state.queue.shift() ?? { access_token: 'tok', scope: 'a b', expires_in: 3600 };
                if ('popup' in step) config.error_callback?.({ type: step.popup });
                else config.callback(step);
              },
            };
          },
          revoke(token: string, done?: (response: { successful?: boolean; error?: string }) => void) {
            state.revoked.push(token);
            done?.(state.revokeResponse);
          },
        },
      },
    },
  };
  state.loadGis.mockImplementation(async () => state.google);
  return state;
});

vi.mock('./gis', () => ({ loadGis: gis.loadGis }));
vi.mock('./auth', () => ({ GOOGLE_CLIENT_ID: 'test-client' }));
vi.mock('./analytics', () => ({ track: vi.fn() }));

/** Fresh module state per test: the live access token is module-level. */
async function load() {
  vi.resetModules();
  return import('./googleHealth');
}

/** XMLHttpRequest that always fails — jsdom has no server to reach. */
class FakeXhr {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(): void {}
  setRequestHeader(): void {}
  send(): void {
    this.onerror?.();
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
  gis.queue.length = 0;
  gis.prompts.length = 0;
  gis.revoked.length = 0;
  gis.revokeResponse = { successful: true };
  localStorage.clear();
});

describe('googleHealth link/unlink', () => {
  it('revokes the live token at Google when unlinking', async () => {
    const mod = await load();
    // The consent popup mints tok1.
    gis.queue.push({ access_token: 'tok1', scope: 'a b', expires_in: 3600 });
    await mod.connectGoogleHealth();
    await mod.disconnectGoogleHealth();
    expect(gis.revoked).toEqual(['tok1']);
    expect(localStorage.getItem('hillgpx:ghealth')).toBeNull();
  });

  it('mints a fresh token to revoke when none is held in memory', async () => {
    const mod = await load();
    localStorage.setItem('hillgpx:ghealth', new Date().toISOString());
    gis.queue.push({ access_token: 'fresh', scope: 'a b', expires_in: 3600 });
    await mod.disconnectGoogleHealth();
    expect(gis.prompts).toEqual(['']);
    expect(gis.revoked).toEqual(['fresh']);
    expect(localStorage.getItem('hillgpx:ghealth')).toBeNull();
  });

  it('clears the local link silently when no grant exists at Google', async () => {
    const mod = await load();
    localStorage.setItem('hillgpx:ghealth', new Date().toISOString());
    gis.queue.push({ error: 'immediate_failed' });
    await expect(mod.disconnectGoogleHealth()).resolves.toBeUndefined();
    expect(gis.revoked).toEqual([]);
    expect(localStorage.getItem('hillgpx:ghealth')).toBeNull();
  });

  it('drops a held token before consenting so a relink re-consents', async () => {
    const mod = await load();
    // Linked once: 'old' sits in memory as this session's token.
    gis.queue.push({ access_token: 'old', scope: 'a', expires_in: 3600 });
    await mod.connectGoogleHealth();
    gis.revoked.length = 0;
    gis.prompts.length = 0;
    // Relink: the held token is revoked and consent goes straight to Google —
    // no silent probe may sit between the click and the popup.
    gis.queue.push({ access_token: 'new', scope: 'a b', expires_in: 3600 });
    await mod.connectGoogleHealth();
    expect(gis.revoked).toEqual(['old']);
    expect(gis.prompts).toEqual(['consent']);
  });

  it('keeps the local link and reports failure when Google refuses the revoke', async () => {
    const mod = await load();
    gis.queue.push({ access_token: 't', scope: 'a b', expires_in: 3600 });
    gis.revokeResponse = { successful: false, error: 'invalid_request' };
    await expect(mod.disconnectGoogleHealth()).rejects.toThrow('Google could not unlink right now');
    expect(localStorage.getItem('hillgpx:ghealth')).not.toBeNull();
  });

  it('warms the GIS script on a status check so the Link click keeps its gesture', async () => {
    const mod = await load();
    gis.loadGis.mockClear();
    await mod.googleHealthStatus();
    expect(gis.loadGis).toHaveBeenCalled();
  });

  it('counts an already-dead grant (invalid_token) as revoked', async () => {
    const mod = await load();
    localStorage.setItem('hillgpx:ghealth', new Date().toISOString());
    gis.queue.push({ access_token: 'dead', scope: 'a b', expires_in: 3600 });
    gis.revokeResponse = { successful: false, error: 'invalid_token' };
    await expect(mod.disconnectGoogleHealth()).resolves.toBeUndefined();
    expect(localStorage.getItem('hillgpx:ghealth')).toBeNull();
  });

  it('falls back to the same-origin relay when Google is unreachable', async () => {
    const mod = await load();
    gis.queue.push({ access_token: 'tok', scope: 'a b', expires_in: 3600 });
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('googleapis')) throw new TypeError('Failed to fetch');
        if (url.startsWith('/api/ghealth')) {
          return new Response('{"dataPoints":[]}', { status: 200, headers: { 'x-ghealth-proxy': '1' } });
        }
        throw new TypeError('unexpected url');
      }),
    );
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    await expect(mod.listGoogleWorkouts()).resolves.toEqual([]);
    expect(calls.some((url) => url.includes('googleapis'))).toBe(true);
    expect(calls.some((url) => url.startsWith('/api/ghealth?kind=workouts'))).toBe(true);
  });

  it('treats a relay-less host (dev, GitHub Pages) as unreachable', async () => {
    const mod = await load();
    gis.queue.push({ access_token: 'tok', scope: 'a b', expires_in: 3600 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('googleapis')) throw new TypeError('Failed to fetch');
        // vite dev / static host answers index.html with no marker header.
        return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }),
    );
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    await expect(mod.listGoogleWorkouts()).rejects.toThrow('Could not reach Google Health');
  });
});
