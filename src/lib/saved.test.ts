import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchSaved: vi.fn(),
  addSaved: vi.fn(),
  removeSaved: vi.fn(),
}));
vi.mock('./api', () => api);
vi.mock('./analytics', () => ({ track: vi.fn() }));

import { loadFavorites, loadRouteBookmarks } from './venues';
import { resetSavedForTests, syncSavedForUser, toggleSavedPlace, toggleSavedRoute } from './saved';

describe('saved items', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.addSaved.mockResolvedValue(undefined);
    api.removeSaved.mockResolvedValue(undefined);
    resetSavedForTests();
  });

  it('keeps saves in this browser while signed out', () => {
    toggleSavedRoute('southern-ridges');
    toggleSavedPlace('bukit-timah');
    expect(loadRouteBookmarks()).toEqual(new Set(['southern-ridges']));
    expect(loadFavorites()).toEqual(new Set(['bukit-timah']));
    expect(api.addSaved).not.toHaveBeenCalled();
  });

  it('merges local saves into the account once, deduplicated, then clears them', async () => {
    toggleSavedRoute('a');
    toggleSavedRoute('b');
    toggleSavedPlace('p1');
    api.fetchSaved.mockResolvedValue({ routes: ['b', 'c'], places: [] });
    await syncSavedForUser('user-1');
    expect(api.addSaved).toHaveBeenCalledWith('user-1', 'route', ['a']);
    expect(api.addSaved).toHaveBeenCalledWith('user-1', 'place', ['p1']);
    expect(loadRouteBookmarks().size).toBe(0);
    expect(loadFavorites().size).toBe(0);
  });

  it('writes toggles to the account when signed in', async () => {
    api.fetchSaved.mockResolvedValue({ routes: [], places: [] });
    await syncSavedForUser('user-1');
    toggleSavedRoute('x');
    expect(api.addSaved).toHaveBeenLastCalledWith('user-1', 'route', ['x']);
    toggleSavedRoute('x');
    expect(api.removeSaved).toHaveBeenCalledWith('user-1', 'route', 'x');
    expect(loadRouteBookmarks().size).toBe(0);
  });

  it('keeps the local copy when the account table is unreachable', async () => {
    toggleSavedRoute('a');
    api.fetchSaved.mockRejectedValue({ code: '42P01' });
    await syncSavedForUser('user-1');
    expect(loadRouteBookmarks()).toEqual(new Set(['a']));
    toggleSavedRoute('b');
    expect(api.addSaved).not.toHaveBeenCalled();
    expect(loadRouteBookmarks()).toEqual(new Set(['a', 'b']));
  });
});
