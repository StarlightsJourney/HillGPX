import { describe, expect, it } from 'vitest';
import { toGpx } from './gpx';

describe('toGpx', () => {
  it('escapes route names for valid XML', () => {
    const xml = toGpx('Ridge <East> & Back', [[103.8, 1.3, 42]]);

    expect(xml).toContain('Ridge &#60;East&#62; &#38; Back');
    expect(xml).not.toContain('<name>Ridge <East>');
  });

  it('omits fabricated elevation when unavailable', () => {
    const xml = toGpx('Unknown elevation', [[114.1, 22.2, 0]], [], false);

    expect(xml).toContain('<trkpt lat="22.200000" lon="114.100000"></trkpt>');
    expect(xml).not.toContain('<ele>');
  });
});
