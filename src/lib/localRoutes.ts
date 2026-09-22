import type { Route } from '../types';

const STORAGE_KEY = 'hillgpx:routes';

export function loadLocalRoutes(): Route[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const routes = JSON.parse(value) as unknown;
    return Array.isArray(routes) ? (routes as Route[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalRoutes(routes: Route[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  } catch {
    throw new Error('This route could not be saved because browser storage is full or unavailable.');
  }
}
