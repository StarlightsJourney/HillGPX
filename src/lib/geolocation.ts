/**
 * One way to ask for the visitor's position and to say why it did not come:
 * Routes near me, the run planner and pinning a photo where you stand.
 */

export type LocationProblem = 'unsupported' | 'denied' | 'timeout' | 'unavailable';

export interface Located {
  lng: number;
  lat: number;
}

/** Asks once for the position; `onProblem` runs straight away when the browser cannot share it. */
export function locate(options: PositionOptions, onFix: (here: Located) => void, onProblem: (problem: LocationProblem) => void): void {
  if (!navigator.geolocation) {
    onProblem('unsupported');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onFix({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
    (err) => onProblem(err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable'),
    options,
  );
}

/** What went wrong, in a sentence. A denial is worded by the caller: it says what allowing would give. */
export function locationProblemText(problem: LocationProblem, denied: string): string {
  switch (problem) {
    case 'unsupported':
      return 'This browser does not share its location.';
    case 'denied':
      return denied;
    case 'timeout':
      return 'Your location took too long to arrive.';
    case 'unavailable':
      return 'Could not get your location.';
  }
}

/**
 * The note over the map after asking for a location: why the map shows what
 * it shows, and what tapping it asks again for: Routes near me (`near-me`),
 * the run planner (`plan`), or nothing (`null`).
 */
export interface LocateHint {
  title: string;
  text: string;
  retry: 'near-me' | 'plan' | null;
}

/** A location problem: tapping the card asks again. */
export function askAgain(text: string, retry: 'near-me' | 'plan' = 'near-me'): LocateHint {
  return { title: 'Share your location', text, retry };
}
