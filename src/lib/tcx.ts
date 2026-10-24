import type { RoutePoint } from '../types';
import { GpxParseError, type ParsedGpx } from './gpx';

/**
 * TCX (Training Center XML) parsing — the format Google Health's
 * exportExerciseTcx endpoint returns for workouts with GPS. Parsed with the
 * browser's DOMParser in the tab, same as GPX files: the track never leaves
 * the device except through the publish step the user confirms.
 *
 * Heart rate, cadence and other <extensions> are dropped on read — the
 * archive keeps the track, not the body.
 */

const SPORT_LABEL: Record<string, string> = {
  running: 'Run',
  biking: 'Ride',
  walking: 'Walk',
  hiking: 'Hike',
  other: 'Workout',
};

/**
 * Read a TCX document into the same shape parseGpx returns, so imported
 * workouts flow through the same simplify / elevation / publish pipeline as
 * dropped GPX files.
 */
export function parseTcx(xml: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new GpxParseError('That file is not valid XML.');
  }
  if (!doc.querySelector('TrainingCenterDatabase')) {
    throw new GpxParseError('That file has no TrainingCenterDatabase root — is it really a TCX?');
  }

  const points: RoutePoint[] = [];
  const times: (number | null)[] = [];
  // Trackpoints without a Position (heart-rate-only rows) carry no track.
  for (const node of Array.from(doc.getElementsByTagName('Trackpoint'))) {
    const position = node.getElementsByTagName('Position')[0];
    const lat = Number(position?.getElementsByTagName('LatitudeDegrees')[0]?.textContent);
    const lng = Number(position?.getElementsByTagName('LongitudeDegrees')[0]?.textContent);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const eleText = node.getElementsByTagName('AltitudeMeters')[0]?.textContent;
    const ele = eleText ? Number(eleText) : 0;
    points.push([lng, lat, Number.isFinite(ele) ? ele : 0]);
    const time = Date.parse(node.getElementsByTagName('Time')[0]?.textContent ?? '');
    times.push(Number.isFinite(time) ? time : null);
  }

  if (points.length === 0) {
    throw new GpxParseError('No GPS track points found in that workout.');
  }

  const activity = doc.getElementsByTagName('Activity')[0];
  const sport = activity?.getAttribute('Sport')?.toLowerCase() ?? '';
  const startedAt = points.length
    ? (activity?.getElementsByTagName('Id')[0]?.textContent ??
      activity?.getElementsByTagName('Lap')[0]?.getAttribute('StartTime') ??
      null)
    : null;

  return {
    name: SPORT_LABEL[sport] ?? null,
    points,
    waypoints: [],
    startedAt: startedAt && Number.isFinite(Date.parse(startedAt)) ? startedAt : (times[0] ? new Date(times[0]).toISOString() : null),
    times,
  };
}
