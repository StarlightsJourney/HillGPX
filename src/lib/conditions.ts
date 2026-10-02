import type { Venue } from '../types';

/**
 * Current conditions at a venue from Open-Meteo: free, keyless and
 * CORS-enabled. Passing the summit's elevation makes Open-Meteo adjust the
 * temperature for altitude, so a 2,000 m peak does not show valley weather.
 * Times come back in the venue's own time zone.
 */
export interface Conditions {
  temperatureC: number;
  feelsLikeC: number;
  windKmh: number;
  rainChance: number | null;
  sunrise: string | null;
  sunset: string | null;
  summary: string;
}

const WEATHER: [number[], string][] = [
  [[0], 'Clear'],
  [[1, 2], 'Partly cloudy'],
  [[3], 'Overcast'],
  [[45, 48], 'Fog'],
  [[51, 53, 55, 56, 57], 'Drizzle'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow'],
  [[95, 96, 99], 'Thunderstorms'],
];

interface OpenMeteo {
  current?: { temperature_2m: number; apparent_temperature: number; wind_speed_10m: number; weather_code: number };
  daily?: { sunrise?: string[]; sunset?: string[]; precipitation_probability_max?: (number | null)[] };
}

const cache = new Map<string, Promise<Conditions | null>>();

export function venueConditions(venue: Venue): Promise<Conditions | null> {
  let pending = cache.get(venue.slug);
  if (!pending) {
    const elevation = venue.type === 'hill' && venue.summitM != null ? `&elevation=${venue.summitM}` : '';
    pending = fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${venue.lat}&longitude=${venue.lng}${elevation}` +
        '&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code' +
        '&daily=sunrise,sunset,precipitation_probability_max&timezone=auto&forecast_days=1',
    )
      .then((r) => (r.ok ? (r.json() as Promise<OpenMeteo>) : null))
      .then((data) => {
        const now = data?.current;
        if (!now) return null;
        return {
          temperatureC: Math.round(now.temperature_2m),
          feelsLikeC: Math.round(now.apparent_temperature),
          windKmh: Math.round(now.wind_speed_10m),
          rainChance: data?.daily?.precipitation_probability_max?.[0] ?? null,
          sunrise: data?.daily?.sunrise?.[0]?.slice(11, 16) ?? null,
          sunset: data?.daily?.sunset?.[0]?.slice(11, 16) ?? null,
          summary: WEATHER.find(([codes]) => codes.includes(now.weather_code))?.[1] ?? 'Mixed',
        };
      })
      .catch(() => {
        cache.delete(venue.slug);
        return null;
      });
    cache.set(venue.slug, pending);
  }
  return pending;
}

/** Turn-by-turn directions in whatever maps app the phone prefers. */
export function directionsUrl(venue: Venue): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`;
}
