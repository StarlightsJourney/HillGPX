import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { loadAuthor } from './api';
import { logIn, logOut, signUp } from './auth';

const SESSION = { token: 'tok123', user: { id: 'u1', username: 'RidgeRunner', email: 'r@x.com', createdAt: '2026-01-01' } };

const ok = () => vi.fn(async () => new Response(JSON.stringify(SESSION), { status: 201 }));
const stored = () => JSON.parse(localStorage.getItem('hillgpx:session') ?? 'null') as typeof SESSION | null;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('auth', () => {
  it('signs up, stores the session and fills an empty contributor name', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    await signUp('RidgeRunner', 'r@x.com', 'password123');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/auth/signup');
    expect((JSON.parse(String(init.body)) as Record<string, unknown>).username).toBe('RidgeRunner');
    expect(stored()?.user.username).toBe('RidgeRunner');
    expect(loadAuthor()).toBe('RidgeRunner');
  });

  it('keeps an existing contributor name on log in', async () => {
    localStorage.setItem('hillgpx:authorName', 'Alex');
    vi.stubGlobal('fetch', ok());
    await logIn('r@x.com', 'password123');
    expect(stored()?.token).toBe('tok123');
    expect(loadAuthor()).toBe('Alex');
  });

  it('logs out: revokes the token on the API and clears local state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(SESSION), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await signUp('RidgeRunner', 'r@x.com', 'password123');
    await logOut();
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain('/api/auth/logout');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    expect(stored()).toBeNull();
  });

  it('drops a stored session the API no longer accepts', async () => {
    localStorage.setItem('hillgpx:session', JSON.stringify(SESSION));
    vi.resetModules();
    const auth = await import('./auth');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('expired', { status: 401 })));
    const { result } = renderHook(() => auth.useAuthUser());
    await waitFor(() => expect(result.current).toBeNull());
    expect(stored()).toBeNull();
  });
});
