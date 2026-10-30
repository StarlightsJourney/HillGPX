import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { changeUsername, deleteMyRoute, editMyRoute, fetchMyRoutes, logIn, logOut, resendConfirmation, resetPasswordForEmail, signUp, useAuthUser } from './auth';

const USER = {
  id: 'u1',
  email: 'r@x.com',
  created_at: '2026-01-01T00:00:00Z',
  app_metadata: { providers: ['email'] },
  user_metadata: { username: 'RidgeRunner' },
};
const SESSION = { access_token: 'tok123', token_type: 'bearer', expires_in: 3600, refresh_token: 'ref1', user: USER };
const SESSION_KEY = 'sb-dzpgnebkyubeptitzjlj-auth-token';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Route mocked fetch calls by URL the way Supabase's endpoints would answer. */
function mockApi(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [match, respond] of Object.entries(overrides)) {
      if (url.includes(match)) return respond(init);
    }
    if (url.includes('/rest/v1/profiles')) {
      // Availability check (username=ilike) is free; the profile fetch (id=eq) finds the row.
      return url.includes('ilike') ? json([]) : json([{ username: 'RidgeRunner', avatar_path: null }]);
    }
    return json({}, 404);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('auth', () => {
  it('signs up, stores the session and mirrors the profile username', async () => {
    const fetchMock = mockApi({ '/auth/v1/signup': () => json(SESSION, 200) });
    vi.stubGlobal('fetch', fetchMock);
    await signUp('RidgeRunner', 'r@x.com', 'password123');
    const signupCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/v1/signup')) as unknown as [string, RequestInit];
    expect(JSON.parse(String(signupCall[1].body))).toMatchObject({ email: 'r@x.com', data: { username: 'RidgeRunner' } });
    const { result } = renderHook(() => useAuthUser());
    await waitFor(() => expect(result.current?.username).toBe('RidgeRunner'));
  });

  it('asks for email confirmation when no session comes back', async () => {
    const fetchMock = mockApi({ '/auth/v1/signup': () => json({ user: USER, session: null }, 200) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(signUp('RidgeRunner', 'r@x.com', 'password123')).resolves.toBe(true);
    const signupCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/v1/signup')) as unknown as [string, RequestInit];
    expect(signupCall[0]).toContain(`redirect_to=${encodeURIComponent('https://hillgpx.com')}`);
  });

  it('emails a password-reset link to the canonical site', async () => {
    const fetchMock = mockApi({ '/auth/v1/recover': () => json({}, 200) });
    vi.stubGlobal('fetch', fetchMock);
    await resetPasswordForEmail('r@x.com');
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/v1/recover')) as unknown as [string, RequestInit];
    expect(call[0]).toContain(`redirect_to=${encodeURIComponent('https://hillgpx.com')}`);
    expect(JSON.parse(String(call[1].body))).toMatchObject({ email: 'r@x.com' });
  });

  it('rejects usernames without looking up or disclosing account emails', async () => {
    const fetchMock = mockApi();
    vi.stubGlobal('fetch', fetchMock);
    await expect(logIn('RidgeRunner', 'password123')).rejects.toThrow('Enter your email address.');
    await expect(resetPasswordForEmail('RidgeRunner')).rejects.toThrow('Enter your email address.');
    await expect(resendConfirmation('RidgeRunner')).rejects.toThrow('Enter your email address.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resends confirmation to the supplied email without a username lookup', async () => {
    const fetchMock = mockApi({ '/auth/v1/resend': () => json({}) });
    vi.stubGlobal('fetch', fetchMock);
    await resendConfirmation(' r@x.com ');
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/v1/resend')) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({ type: 'signup', email: 'r@x.com' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('email_for_username'))).toBe(false);
  });

  it('logs in and stores the session', async () => {
    vi.stubGlobal('fetch', mockApi({ '/auth/v1/token': () => json(SESSION) }));
    await logIn('r@x.com', 'password123');
    const { result } = renderHook(() => useAuthUser());
    await waitFor(() => expect(result.current?.username).toBe('RidgeRunner'));
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')?.access_token).toBe('tok123');
  });

  it('logs out: revokes the session, clears local state and returns home', async () => {
    const fetchMock = mockApi({
      '/auth/v1/signup': () => json(SESSION, 200),
      '/auth/v1/logout': () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await signUp('RidgeRunner', 'r@x.com', 'password123');
    window.location.hash = '#account';
    await logOut();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/v1/logout'))).toBe(true);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('sends Gmail addresses to the Google button when it is configured', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    vi.resetModules();
    const googleAuth = await import('./auth');
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    for (const email of ['r@gmail.com', 'r@googlemail.com']) {
      await expect(googleAuth.signUp('RidgeRunner', email, 'password123')).rejects.toThrow('Google');
      await expect(googleAuth.logIn(email, 'password123')).rejects.toThrow('Google');
      await expect(googleAuth.resetPasswordForEmail(email)).rejects.toThrow('Google');
      await expect(googleAuth.resendConfirmation(email)).rejects.toThrow('Google');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still takes Gmail on email sign-up when Google sign-in is not configured', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    vi.resetModules();
    const emailOnlyAuth = await import('./auth');
    const fetchMock = mockApi({ '/auth/v1/signup': () => json(SESSION, 200) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(emailOnlyAuth.signUp('RidgeRunner', 'r@gmail.com', 'password123')).resolves.toBe(false);
  });

  it('renames the profile handle', async () => {
    let storedName = 'RidgeRunner';
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/auth/v1/user': (init) =>
        init?.method === 'PUT' ? json({ ...USER, user_metadata: { username: 'NewRidge' } }) : json(USER),
      '/rest/v1/profiles': (init) => {
        if (init?.method === 'PATCH') {
          storedName = (JSON.parse(String(init.body)) as { username: string }).username;
          return json(null);
        }
        return json([{ username: storedName, avatar_path: null }]);
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await changeUsername('NewRidge');
    expect(storedName).toBe('NewRidge');
    const { result } = renderHook(() => useAuthUser());
    await waitFor(() => expect(result.current?.username).toBe('NewRidge'));
  });

  it('refuses a rename to a handle someone else already has', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/profiles': (init) =>
        init?.method === 'PATCH' ? json(null) : json([{ id: 'u2', username: 'TakenName' }]),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(changeUsername('takenname')).rejects.toThrow('That username is taken.');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('explains missing account schema instead of returning a generic HTTP 400', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/routes': () => json({ code: '42703', message: 'column routes.user_id does not exist' }, 400),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(fetchMyRoutes()).rejects.toMatchObject({
      message: 'Account features are temporarily unavailable. Please try again later.',
      status: 503,
      code: '42703',
    });
  });

  it('keeps the owner filter when retrying an older optional-column schema', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    let routeCalls = 0;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/rest/v1/routes')) return fetchMock(input, init);
      requests.push(url);
      routeCalls += 1;
      return routeCalls === 1
        ? json({ code: '42703', message: 'column routes.downloads does not exist' }, 400)
        : json([]);
    }));
    await expect(fetchMyRoutes()).resolves.toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests.every((url) => new URL(url).searchParams.get('user_id') === 'eq.u1')).toBe(true);
    expect(new URL(requests[1]).searchParams.get('select')).not.toContain('downloads');
  });

  it('drops a stored session Supabase no longer accepts', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...SESSION, expires_at: 1 }));
    vi.resetModules();
    const auth = await import('./auth');
    vi.stubGlobal('fetch', mockApi({ '/auth/v1/token': () => json({ error: 'invalid_grant' }, 400) }));
    const { result } = renderHook(() => auth.useAuthUser());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('deletes an owned route through the cleanup RPC', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/rpc/delete_community_route': () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(deleteMyRoute('mine')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/rest/v1/routes'))).toBe(false);
  });

  it('falls back to the row delete policy when the cleanup RPC is denied', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/rpc/delete_community_route': () =>
        json({ code: '42501', message: 'permission denied for function delete_community_route' }, 401),
      '/rest/v1/routes': (init) => (init?.method === 'DELETE' ? json([{ slug: 'mine' }]) : json([])),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(deleteMyRoute('mine')).resolves.toBeUndefined();
    const call = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/rest/v1/routes') && (init as RequestInit)?.method === 'DELETE') as unknown as [string, RequestInit];
    const params = new URL(call[0]).searchParams;
    expect(params.get('slug')).toBe('eq.mine');
    expect(params.get('user_id')).toBe('eq.u1');
  });

  it('reports a route the fallback cannot delete instead of failing silently', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/rpc/delete_community_route': () =>
        json({ code: 'PGRST202', message: 'Could not find the function' }, 404),
      '/rest/v1/routes': (init) => (init?.method === 'DELETE' ? json([]) : json([])),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(deleteMyRoute('not-mine')).rejects.toThrow('No such route on your account.');
  });

  it('renames and re-credits an owned route through the edit RPC, without touching storage', async () => {
    let body: Record<string, unknown> | null = null;
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/rpc/edit_community_route': (init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 204 });
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(editMyRoute('mine', { name: ' Ridge Loop ', anonymous: true })).resolves.toEqual({ gpxPath: null });
    expect(body).toMatchObject({ p_slug: 'mine', p_name: 'Ridge Loop', p_anonymous: true, p_points: null, p_gpx_path: null });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/storage/'))).toBe(false);
  });

  it('uploads the regenerated file before the RPC swaps it in for a trim', async () => {
    const calls: string[] = [];
    let body: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/auth/v1/token')) return json(SESSION);
      if (url.includes('/rest/v1/profiles')) return url.includes('ilike') ? json([]) : json([{ username: 'RidgeRunner', avatar_path: null }]);
      if (url.includes('/storage/v1/object/gpx/')) return json({ Key: 'gpx/x' });
      if (url.includes('/rest/v1/rpc/edit_community_route')) {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 204 });
      }
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    const result = await editMyRoute('mine', {
      track: {
        points: [
          [103.8, 1.36, 10],
          [103.81, 1.37, 12],
        ],
        distanceM: 1000,
        gainM: 20,
        lossM: 5,
        venueSlugs: ['bukit-timah'],
        fingerprint: 'abc12345',
        gpxText: '<gpx/>',
        qualityFlags: [],
      },
    });
    expect(result.gpxPath).toMatch(/^mine-e[0-9a-f]{8}\.gpx(\.gz)?$/);
    const uploadIdx = calls.findIndex((url) => url.includes('/storage/v1/object/gpx/'));
    const rpcIdx = calls.findIndex((url) => url.includes('edit_community_route'));
    expect(uploadIdx).toBeGreaterThanOrEqual(0);
    expect(rpcIdx).toBeGreaterThan(uploadIdx);
    expect(calls[uploadIdx]).toContain(result.gpxPath ?? 'never');
    expect(body).toMatchObject({
      p_slug: 'mine',
      p_gpx_path: result.gpxPath,
      p_quality_flags: [],
      p_distance_m: 1000,
      p_gain_m: 20,
      p_loss_m: 5,
      p_geom_hash: 'abc12345',
      p_venue_slugs: ['bukit-timah'],
    });
  });

  it('maps a trimmed track that duplicates another route to the duplicate sentence', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/storage/v1/object/gpx/': () => json({ Key: 'gpx/x' }),
      '/rest/v1/rpc/edit_community_route': () =>
        json({ code: '23505', message: 'duplicate key value violates unique constraint "routes_geom_hash_key"' }, 409),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(
      editMyRoute('mine', {
        track: {
          points: [
            [103.8, 1.36, 10],
            [103.81, 1.37, 12],
          ],
          distanceM: 1000,
          gainM: 20,
          lossM: 5,
          venueSlugs: [],
          fingerprint: 'abc12345',
          gpxText: '<gpx/>',
          qualityFlags: [],
        },
      }),
    ).rejects.toThrow('That trimmed track is already in the community archive.');
  });

  it('explains when the edit RPC has not been applied yet', async () => {
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/rpc/edit_community_route': () =>
        json({ code: 'PGRST202', message: 'Could not find the function' }, 404),
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(editMyRoute('mine', { name: 'Ridge Loop' })).rejects.toMatchObject({
      message: 'Route editing is not available yet — the latest database change is still being applied.',
      status: 503,
    });
  });

  it('refreshes an expired session token once before retrying the RPC', async () => {
    let rpcCalls = 0;
    const fetchMock = mockApi({
      '/auth/v1/token': () => json(SESSION),
      '/rest/v1/rpc/delete_community_route': () => {
        rpcCalls += 1;
        return rpcCalls === 1
          ? json({ code: 'PGRST301', message: 'JWT expired' }, 401)
          : new Response(null, { status: 204 });
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    await logIn('r@x.com', 'password123');
    await expect(deleteMyRoute('mine')).resolves.toBeUndefined();
    expect(rpcCalls).toBe(2);
  });
});
