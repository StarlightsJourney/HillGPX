import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';
import { toGpx } from './gpx';
import { parseTcx } from './tcx';

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-04-20T08:00:00Z</Id>
      <Lap StartTime="2026-04-20T08:00:00Z">
        <TotalTimeSeconds>120</TotalTimeSeconds>
        <DistanceMeters>420</DistanceMeters>
        <Track>
          <Trackpoint>
            <Time>2026-04-20T08:00:00Z</Time>
            <Position>
              <LatitudeDegrees>1.3520</LatitudeDegrees>
              <LongitudeDegrees>103.7768</LongitudeDegrees>
            </Position>
            <AltitudeMeters>82.0</AltitudeMeters>
            <DistanceMeters>0.0</DistanceMeters>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-04-20T08:01:00Z</Time>
            <Position>
              <LatitudeDegrees>1.3525</LatitudeDegrees>
              <LongitudeDegrees>103.7772</LongitudeDegrees>
            </Position>
            <AltitudeMeters>88.5</AltitudeMeters>
            <HeartRateBpm><Value>152</Value></HeartRateBpm>
            <DistanceMeters>210.0</DistanceMeters>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-04-20T08:02:00Z</Time>
            <HeartRateBpm><Value>158</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-04-20T08:02:30Z</Time>
            <Position>
              <LatitudeDegrees>1.3530</LatitudeDegrees>
              <LongitudeDegrees>103.7778</LongitudeDegrees>
            </Position>
            <AltitudeMeters>95.1</AltitudeMeters>
            <DistanceMeters>420.0</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

describe('parseTcx', () => {
  it('reads positioned trackpoints, skipping heart-rate-only rows', () => {
    const parsed = parseTcx(TCX);

    expect(parsed.points).toEqual([
      [103.7768, 1.352, 82],
      [103.7772, 1.3525, 88.5],
      [103.7778, 1.353, 95.1],
    ]);
    expect(parsed.name).toBe('Run');
    expect(parsed.startedAt).toBe('2026-04-20T08:00:00Z');
    expect(parsed.times.every((t) => typeof t === 'number')).toBe(true);
  });

  it('rejects documents with no track', () => {
    expect(() => parseTcx('<?xml version="1.0"?><TrainingCenterDatabase><Activities/></TrainingCenterDatabase>')).toThrow(
      /No GPS track points/,
    );
    expect(() => parseTcx('<gpx/>')).toThrow(/TrainingCenterDatabase/);
  });
});

describe('TCX → GPX conversion', () => {
  it('round-trips through toGpx + parseGpx keeping points and times', () => {
    const parsed = parseTcx(TCX);
    const gpx = toGpx('Morning run', parsed.points, [], true, parsed.times);
    const again = parseGpx(gpx);

    expect(again.points).toEqual(parsed.points);
    expect(again.times).toEqual(parsed.times);
    expect(again.startedAt).toBe('2026-04-20T08:00:00.000Z');
    expect(gpx).not.toContain('HeartRate');
  });
});
