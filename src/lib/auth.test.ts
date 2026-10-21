import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { loadAuthor } from './api';
import { logIn, logOut, signUp } from './auth';

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

  it('drops a stored session Supabase no longer accepts', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...SESSION, expires_at: 1 }));
    vi.resetModules();
    const auth = await import('./auth');
    vi.stubGlobal('fetch', mockApi({ '/auth/v1/token': () => json({ error: 'invalid_grant' }, 400) }));
    const { result } = renderHook(() => auth.useAuthUser());
    await waitFor(() => expect(result.current).toBeNull());
  });
});
