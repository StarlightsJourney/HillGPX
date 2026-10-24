import { describe, expect, it } from 'vitest';
import { lengthText } from './matchText';

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
