import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodePlace } from './regions';

type Feature = { name: string; countrycode: string; type: string; extent?: [number, number, number, number]; point: [number, number] };

function answer(features: Feature[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          features: features.map((f) => ({
            geometry: { coordinates: f.point },
            properties: { name: f.name, countrycode: f.countrycode, type: f.type, extent: f.extent },
          })),
        }),
      ),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('geocodePlace', () => {
  it('prefers an answer in the visitor’s country over a more famous one abroad', async () => {
    answer([
      { name: 'Night Walk', countrycode: 'GB', type: 'street', extent: [-1.1, 52.1, -1.0, 52.0], point: [-1.05, 52.05] },
      { name: 'University Town', countrycode: 'SG', type: 'house', extent: [103.77, 1.31, 103.78, 1.30], point: [103.775, 1.305] },
    ]);
    const box = await geocodePlace('utown night walk', undefined, 'SG');
    expect(box?.west).toBeCloseTo(103.77);
  });

  it('keeps the first answer when none is at home', async () => {
    answer([
      { name: 'Paris', countrycode: 'FR', type: 'city', extent: [2.2, 48.9, 2.5, 48.8], point: [2.35, 48.85] },
      { name: 'Paris', countrycode: 'US', type: 'city', extent: [-95.6, 33.7, -95.5, 33.6], point: [-95.55, 33.66] },
    ]);
    const box = await geocodePlace('paris', undefined, 'SG');
    expect(box?.west).toBeCloseTo(2.2);
  });

  it('prefers an area with an outline over a point', async () => {
    answer([
      { name: 'Kyoto', countrycode: 'JP', type: 'house', point: [135.76, 35.01] },
      { name: 'Kyoto', countrycode: 'JP', type: 'city', extent: [135.5, 35.3, 135.9, 34.9], point: [135.76, 35.01] },
    ]);
    const box = await geocodePlace('kyoto');
    expect(box).toEqual({ west: 135.5, south: 34.9, east: 135.9, north: 35.3 });
  });

  it('does not trade an outlined building for an area without one', async () => {
    answer([
      { name: 'Holland Village', countrycode: 'SG', type: 'house', extent: [103.79, 1.313, 103.797, 1.309], point: [103.794, 1.311] },
      { name: 'Holland Village', countrycode: 'SG', type: 'locality', point: [103.795, 1.31] },
    ]);
    const box = await geocodePlace('holland village', undefined, 'SG');
    expect(box?.west).toBeCloseTo(103.79);
  });
});
