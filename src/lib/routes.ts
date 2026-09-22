import type { Route, RoutePoint, Venue } from '../types';
import { computeGain, haversineM, totalDistanceM } from './elevation';

export function linkVenues(points: RoutePoint[], venues: Venue[], radiusM = 150): string[] {
  if (points.length === 0) return [];
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const latPad = radiusM / 111_320;
  const lngPad = radiusM / (111_320 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  const west = Math.min(...lngs) - lngPad;
  const east = Math.max(...lngs) + lngPad;
  const south = Math.min(...lats) - latPad;
  const north = Math.max(...lats) + latPad;

  return venues
    .filter(
      (venue) =>
        venue.type !== 'hdb_block' &&
        venue.lng >= west &&
        venue.lng <= east &&
        venue.lat >= south &&
        venue.lat <= north,
    )
    .map((venue) => {
      const firstTouch = points.findIndex(
        ([lng, lat]) => haversineM(lng, lat, venue.lng, venue.lat) <= radiusM,
      );
      return { slug: venue.slug, firstTouch };
    })
    .filter((match) => match.firstTouch >= 0)
    .sort((a, b) => a.firstTouch - b.firstTouch)
    .map((match) => match.slug);
}

function shortHash(points: RoutePoint[]): string {
  let hash = 2166136261;
  for (const point of points) {
    const text = `${point[0].toFixed(6)},${point[1].toFixed(6)},${point[2].toFixed(1)};`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36).slice(0, 7);
}

export function routeFromPoints(name: string, points: RoutePoint[], venueSlugs: string[]): Route {
  const coordinates = points.map(
    ([lng, lat, elevation]) =>
      [Number(lng.toFixed(6)), Number(lat.toFixed(6)), Number(elevation.toFixed(1))] as RoutePoint,
  );
  const { gainM, lossM } = computeGain(coordinates);
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'route';
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  return {
    slug: `${baseSlug}-${shortHash(coordinates)}`,
    name,
    venueSlugs,
    distanceM: Math.round(totalDistanceM(coordinates)),
    gainM,
    lossM,
    loop: Boolean(first && last && haversineM(first[0], first[1], last[0], last[1]) < 100),
    coordinates,
    source: 'local',
  };
}
