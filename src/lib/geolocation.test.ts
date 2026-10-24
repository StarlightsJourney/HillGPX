import { afterEach, describe, expect, it, vi } from 'vitest';
import { locate, locationProblemText } from './geolocation';

const realNavigator = globalThis.navigator;
afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: realNavigator, configurable: true });
});

function withGeolocation(geolocation: Partial<Geolocation> | undefined) {
  Object.defineProperty(globalThis, 'navigator', { value: { geolocation }, configurable: true });
}

describe('locate', () => {
  it('hands back the fix as lng/lat', () => {
    withGeolocation({
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { longitude: 103.8, latitude: 1.3 } } as GeolocationPosition),
    });
    const onFix = vi.fn();
    locate({}, onFix, () => undefined);
    expect(onFix).toHaveBeenCalledWith({ lng: 103.8, lat: 1.3 });
  });

  it('names the problem: unsupported, denied, timed out or unavailable', () => {
    const problems: string[] = [];
    withGeolocation(undefined);
    locate({}, () => undefined, (p) => problems.push(p));
    for (const code of [1, 3, 2]) {
      withGeolocation({
        getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
          fail?.({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError),
      });
      locate({}, () => undefined, (p) => problems.push(p));
    }
    expect(problems).toEqual(['unsupported', 'denied', 'timeout', 'unavailable']);
  });
});

describe('locationProblemText', () => {
  it('says what went wrong, with the caller asking for permission in its own words', () => {
    expect(locationProblemText('unsupported', 'Allow location.')).toBe('This browser does not share its location.');
    expect(locationProblemText('denied', 'Allow location to rank routes near you.')).toBe('Allow location to rank routes near you.');
    expect(locationProblemText('timeout', 'x')).toBe('Your location took too long to arrive.');
    expect(locationProblemText('unavailable', 'x')).toBe('Could not get your location.');
  });
});
