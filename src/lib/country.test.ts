import { describe, expect, it } from 'vitest';
import { fromTimeZone } from './country';

describe('fromTimeZone', () => {
  it('maps a zone to its country', async () => {
    expect(await fromTimeZone('Asia/Singapore')).toBe('SG');
    expect(await fromTimeZone('Europe/London')).toBe('GB');
    expect(await fromTimeZone('America/Denver')).toBe('US');
  });

  it('knows the old names browsers still report', async () => {
    expect(await fromTimeZone('Asia/Calcutta')).toBe('IN');
    expect(await fromTimeZone('Asia/Saigon')).toBe('VN');
  });

  it('is null for zones without a country', async () => {
    expect(await fromTimeZone('UTC')).toBeNull();
    expect(await fromTimeZone('')).toBeNull();
  });
});
