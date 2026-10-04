import { useUnits } from './UnitsContext';

/**
 * Metres or feet. The whole pill is one button: a click anywhere on it swaps
 * the units, and the thumb slides to show which one is on.
 */
export function HeaderControls() {
  const units = useUnits();
  const imperial = units.units === 'imperial';
  const label = imperial ? 'Units: feet. Switch to metres' : 'Units: metres. Switch to feet';
  return (
    <button
      type="button"
      className="units-toggle"
      aria-label={label}
      title={label}
      onClick={() => units.setUnits(imperial ? 'metric' : 'imperial')}
    >
      <span className={`units-thumb${imperial ? ' right' : ''}`} aria-hidden="true" />
      <span className={`units-opt${imperial ? '' : ' on'}`} aria-hidden="true">m</span>
      <span className={`units-opt${imperial ? ' on' : ''}`} aria-hidden="true">ft</span>
    </button>
  );
}
