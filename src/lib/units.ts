/**
 * Which units heights and distances are printed in.
 *
 * Metres stay the only unit the app stores or computes in: the terrain model is
 * int16 metres, the venue files are metres, and the gain threshold in
 * elevation.ts is a metre figure shared with build_data.py. Converting on the
 * way in would push every one of those through a lossy round trip so that a
 * verified 163 m could read back as 162 — so imperial exists at the point of
 * display and nowhere else.
 *
 * Feet rather than a full locale system because a unit is the one preference
 * this app genuinely has. There is no i18n here and nothing is priced, so the
 * usual language-and-currency pair has nothing to offer.
 */

export type Units = 'metric' | 'imperial';

export const M_TO_FT = 3.280839895;
const M_TO_MI = 0.000621371;

/**
 * Below this, an imperial distance reads better in feet than as "0.1 mi".
 * Roughly a tenth of a mile, which is where walking directions everywhere
 * switch over.
 */
const FEET_BELOW_M = 160;

const STORAGE_KEY = 'hillgpx.units';

/**
 * localStorage throws rather than returning null in Safari's private mode and
 * wherever site data is blocked, and a preference is never worth taking the app
 * down for — so both directions swallow the failure and the session simply
 * falls back to metres.
 */
export function loadUnits(): Units {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

export function saveUnits(units: Units): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, units);
  } catch {
    // Nothing to do and nothing worth telling anyone: the choice still holds
    // for this session, it just will not survive a reload.
  }
}

/**
 * A height, in whole units.
 *
 * Never fractional: the underlying numbers are seed values and DEM samples with
 * metres of error in them, and "534.8 ft" claims a precision the data has not
 * got. See the known-limitation note in the README.
 */
export function formatHeight(metres: number, units: Units): string {
  return units === 'imperial'
    ? `${Math.round(metres * M_TO_FT)} ft`
    : `${Math.round(metres)} m`;
}

/** A distance — feet and miles under imperial, metres and kilometres otherwise. */
export function formatDistanceIn(metres: number, units: Units): string {
  if (units === 'imperial') {
    return metres < FEET_BELOW_M
      ? `${Math.round(metres * M_TO_FT)} ft`
      : `${(metres * M_TO_MI).toFixed(1)} mi`;
  }
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}
