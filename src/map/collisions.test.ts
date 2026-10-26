import { describe, expect, it } from 'vitest';
import { placePins, type PinBox } from './collisions';

const pill = (id: string, x: number, y: number, extra: Partial<PinBox> = {}): PinBox => ({
  id,
  x,
  y,
  width: 90,
  height: 32,
  ...extra,
});

describe('placePins', () => {
  it('keeps pins that do not touch', () => {
    expect(placePins([pill('a', 0, 0), pill('b', 200, 0), pill('c', 0, 100)])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('hides the later of two overlapping pins', () => {
    expect(placePins([pill('a', 0, 0), pill('b', 60, 10)])).toEqual(new Set(['a']));
  });

  it('counts the gap: pins just apart still collide when the gap would close', () => {
    expect(placePins([pill('a', 0, 0), pill('b', 91, 0)], 0)).toEqual(new Set(['a', 'b']));
    expect(placePins([pill('a', 0, 0), pill('b', 91, 0)], 2)).toEqual(new Set(['a']));
  });

  it('a pin overlapping only a hidden pin still shows', () => {
    // b loses to a; c overlaps b but not a, so it stays.
    expect(placePins([pill('a', 0, 0), pill('b', 80, 0), pill('c', 160, 0)])).toEqual(new Set(['a', 'c']));
  });

  it('forced pins win over earlier ones and always show', () => {
    const shown = placePins([pill('a', 0, 0), pill('b', 40, 0, { forced: true }), pill('c', 50, 5, { forced: true })]);
    expect(shown).toEqual(new Set(['b', 'c']));
  });

  it('reveals pins once they spread apart (zooming in)', () => {
    const at = (scale: number) => placePins([pill('a', 0, 0), pill('b', 70 * scale, 0)]);
    expect(at(1)).toEqual(new Set(['a']));
    expect(at(2)).toEqual(new Set(['a', 'b']));
  });
});
