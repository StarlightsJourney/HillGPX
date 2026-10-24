import { beforeEach, describe, expect, it } from 'vitest';
import { loadFavorites, loadRouteBookmarks, saveFavorites, saveRouteBookmarks, toggleRouteBookmark } from './venues';

describe('route bookmarks on this device', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty when nothing is stored', () => {
    expect(loadRouteBookmarks()).toEqual(new Set());
  });

  it('keeps saved route slugs across loads', () => {
    saveRouteBookmarks(new Set(['southern-ridges', 'hong-kong-trail']));
    expect(loadRouteBookmarks()).toEqual(new Set(['southern-ridges', 'hong-kong-trail']));
  });

  it('stores them as a JSON array under hillgpx:routeBookmarks', () => {
    saveRouteBookmarks(new Set(['southern-ridges']));
    expect(JSON.parse(localStorage.getItem('hillgpx:routeBookmarks') ?? 'null')).toEqual(['southern-ridges']);
  });

  it('treats corrupt storage as empty', () => {
    localStorage.setItem('hillgpx:routeBookmarks', '{not json');
    expect(loadRouteBookmarks()).toEqual(new Set());
  });

  it('ignores a stored value that is not a list of slugs', () => {
    localStorage.setItem('hillgpx:routeBookmarks', JSON.stringify({ slug: 'southern-ridges' }));
    expect(loadRouteBookmarks()).toEqual(new Set());
    localStorage.setItem('hillgpx:routeBookmarks', JSON.stringify(['kluang', 7, null]));
    expect(loadRouteBookmarks()).toEqual(new Set(['kluang']));
  });

  it('toggles a bookmark on and off and persists each change', () => {
    expect(toggleRouteBookmark('kluang')).toEqual(new Set(['kluang']));
    expect(loadRouteBookmarks()).toEqual(new Set(['kluang']));
    expect(toggleRouteBookmark('kluang')).toEqual(new Set());
    expect(loadRouteBookmarks()).toEqual(new Set());
  });

  it('does not touch saved places', () => {
    localStorage.setItem('hillgpx:favorites', JSON.stringify(['bukit-timah']));
    toggleRouteBookmark('southern-ridges');
    expect(localStorage.getItem('hillgpx:favorites')).toBe('["bukit-timah"]');
    expect(loadFavorites()).toEqual(new Set(['bukit-timah']));
    saveFavorites(new Set(['bukit-timah', 'mount-faber']));
    expect(loadRouteBookmarks()).toEqual(new Set(['southern-ridges']));
  });
});
