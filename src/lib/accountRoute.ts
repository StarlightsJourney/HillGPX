import { useSyncExternalStore } from 'react';

/**
 * Where the account area is, read from the URL hash so every view can be
 * deep-linked, survives a refresh and works with the browser's back button.
 *
 *   #account                     Your routes (the profile's home)
 *   #account/stats[/routes]      Stats, Overview or By route
 *   #account/saved[/places]      Saved, Routes or Places
 *   #settings/<section>          Settings (profile | preferences | account | data)
 *
 * `#uploads` is the old address for Your routes and keeps working.
 */
export type AccountView = 'routes' | 'stats' | 'saved';
export type StatsTab = 'overview' | 'by-route';
export type SavedTab = 'routes' | 'places';
export type SettingsSection = 'profile' | 'preferences' | 'account' | 'data';

export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['profile', 'preferences', 'account', 'data'];

export type AccountRoute =
  | { page: 'account'; view: AccountView; statsTab: StatsTab; savedTab: SavedTab }
  | { page: 'settings'; section: SettingsSection };

export const accountHref = {
  routes: '#account',
  stats: (tab: StatsTab = 'overview') => (tab === 'by-route' ? '#account/stats/routes' : '#account/stats'),
  saved: (tab: SavedTab = 'routes') => (tab === 'places' ? '#account/saved/places' : '#account/saved'),
  settings: (section: SettingsSection = 'profile') => `#settings/${section}`,
} as const;

/** The account route a hash names, or null when it is not an account address. */
export function parseAccountHash(hash: string): AccountRoute | null {
  const parts = hash.replace(/^#/, '').split('/');
  const head = parts[0];
  if (head === 'uploads') return { page: 'account', view: 'routes', statsTab: 'overview', savedTab: 'routes' };
  if (head === 'settings') {
    const section = SETTINGS_SECTIONS.find((id) => id === parts[1]);
    return { page: 'settings', section: section ?? 'profile' };
  }
  if (head !== 'account') return null;
  const view: AccountView = parts[1] === 'stats' || parts[1] === 'saved' ? parts[1] : 'routes';
  return {
    page: 'account',
    view,
    statsTab: view === 'stats' && parts[2] === 'routes' ? 'by-route' : 'overview',
    savedTab: view === 'saved' && parts[2] === 'places' ? 'places' : 'routes',
  };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => '');
}

export function useAccountRoute(): AccountRoute {
  const hash = useHash();
  return parseAccountHash(hash) ?? { page: 'account', view: 'routes', statsTab: 'overview', savedTab: 'routes' };
}
