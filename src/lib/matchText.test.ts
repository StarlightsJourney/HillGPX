import { describe, expect, it } from 'vitest';
import { describeMiss, describeReasons, lengthText } from './matchText';

describe('describeReasons', () => {
  const reasons = [
    { kind: 'away', metres: 2_000 },
    { kind: 'length', metres: 8_400, durationS: 50 * 60 + 40 },
    { kind: 'terrain', band: 'rolling', climbRateMPerKm: 18.2 },
  ] as const;

  it('reads as one line in metric', () => {
    expect(describeReasons([...reasons], 'metric')).toBe('2 km away · 8.4 km, about 50 min · Rolling (18 m/km)');
  });

  it('drops a trailing .0 but keeps a decimal that says something', () => {
    expect(describeReasons([{ kind: 'away', metres: 12_000 }], 'metric')).toBe('12 km away');
    expect(describeReasons([{ kind: 'away', metres: 2_450 }], 'metric')).toBe('2.5 km away');
    expect(describeReasons([{ kind: 'away', metres: 3_219 }], 'imperial')).toBe('2 mi away');
    expect(describeReasons([{ kind: 'away', metres: 640 }], 'metric')).toBe('640 m away');
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
    expect(describeMiss({ kind: 'length', unit: 'distance', by: 4_000, longer: true }, 'metric')).toBe('4 km longer than you asked');
    expect(describeMiss({ kind: 'length', unit: 'distance', by: 4_000, longer: false }, 'imperial')).toBe('2.5 mi shorter than you asked');
    expect(describeMiss({ kind: 'length', unit: 'time', by: 40 * 60, longer: true }, 'metric')).toBe('40 min longer than you asked');
    expect(describeMiss({ kind: 'length', unit: 'time', by: 405 * 60, longer: true }, 'metric')).toBe('6 h 45 min longer than you asked');
  });

  it('names the terrain it is instead', () => {
    expect(describeMiss({ kind: 'terrain', wanted: 'flat', band: 'hilly' }, 'metric')).toBe('Hilly, not flat');
  });
});

describe('lengthText', () => {
  it('words times in minutes or hours', () => {
    expect(lengthText({ kind: 'time', minutes: 45 }, 'metric')).toBe('45 min');
    expect(lengthText({ kind: 'time', minutes: 90 }, 'metric')).toBe('1.5 h');
  });

  it('words distances in the unit setting, without a trailing .0', () => {
    expect(lengthText({ kind: 'distance', metres: 10_000 }, 'metric')).toBe('10 km');
    expect(lengthText({ kind: 'distance', metres: 9_656 }, 'imperial')).toBe('6 mi');
  });

  it('names the half marathon', () => {
    expect(lengthText({ kind: 'distance', metres: 21_097 }, 'imperial')).toBe('Half marathon');
  });
});
