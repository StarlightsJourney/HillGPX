import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { loadAuthor } from './api';
import { deleteMyRoute, fetchMyRoutes, logIn, logOut, resendConfirmation, resetPasswordForEmail, signUp } from './auth';

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
  localStorage.clear();
});

describe('auth', () => {
  it('signs up, stores the session and fills an empty contributor name', async () => {
    const fetchMock = mockApi({ '/auth/v1/signup': () => json(SESSION, 200) });
    vi.stubGlobal('fetch', fetchMock);
    await signUp('RidgeRunner', 'r@x.com', 'password123');
    const signupCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/v1/signup')) as unknown as [string, RequestInit];
    expect(JSON.parse(String(signupCall[1].body))).toMatchObject({ email: 'r@x.com', data: { username: 'RidgeRunner' } });
    await waitFor(() => expect(loadAuthor()).toBe('RidgeRunner'));
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

  it('keeps an existing contributor name on log in', async () => {
    localStorage.setItem('hillgpx:authorName', 'Alex');
    vi.stubGlobal('fetch', mockApi({ '/auth/v1/token': () => json(SESSION) }));
    await logIn('r@x.com', 'password123');
    await waitFor(() => expect(loadAuthor()).toBe('Alex'));
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')?.access_token).toBe('tok123');
  });

  it('logs out: revokes the session and clears local state', async () => {
    const fetchMock = mockApi({
      '/auth/v1/signup': () => json(SESSION, 200),
      '/auth/v1/logout': () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await signUp('RidgeRunner', 'r@x.com', 'password123');
    await logOut();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/v1/logout'))).toBe(true);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
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
