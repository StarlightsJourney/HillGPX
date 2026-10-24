import { describe, expect, it } from 'vitest';
import { describeMiss, describeReasons } from './matchText';

describe('describeReasons', () => {
  const reasons = [
    { kind: 'away', metres: 2_000 },
    { kind: 'length', metres: 8_400, durationS: 50 * 60 + 40 },
    { kind: 'terrain', band: 'rolling', climbRateMPerKm: 18.2 },
  ] as const;

  it('reads as one line in metric', () => {
    expect(describeReasons([...reasons], 'metric')).toBe('2.0 km away · 8.4 km, about 50 min · Rolling (18 m/km)');
  });

  it('follows the imperial setting', () => {
    // 18.2 m/km is 96 ft/mi.
    expect(describeReasons([...reasons], 'imperial')).toBe('1.2 mi away · 5.2 mi, about 50 min · Rolling (96 ft/mi)');
  });

  it('says a route crossing the area is in it, gives long runs in hours, and admits unknown elevation', () => {
    expect(
      describeReasons(
        [
          { kind: 'away', metres: 0 },
          { kind: 'length', metres: 14_400, durationS: 85 * 60 },
          { kind: 'terrain', band: null, climbRateMPerKm: null },
        ],
        'metric',
      ),
    ).toBe('In this area · 14.4 km, about 1 h 25 min · elevation unknown');
  });
});

describe('describeMiss', () => {
  it('says how much longer or shorter, in the asked unit', () => {
    expect(describeMiss({ kind: 'length', unit: 'distance', by: 4_000, longer: true }, 'metric')).toBe('4.0 km longer than you asked');
    expect(describeMiss({ kind: 'length', unit: 'distance', by: 4_000, longer: false }, 'imperial')).toBe('2.5 mi shorter than you asked');
    expect(describeMiss({ kind: 'length', unit: 'time', by: 40 * 60, longer: true }, 'metric')).toBe('40 min longer than you asked');
    expect(describeMiss({ kind: 'length', unit: 'time', by: 405 * 60, longer: true }, 'metric')).toBe('6 h 45 min longer than you asked');
  });

  it('names the terrain it is instead', () => {
    expect(describeMiss({ kind: 'terrain', wanted: 'flat', band: 'hilly' }, 'metric')).toBe('Hilly, not flat');
  });
});
