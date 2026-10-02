import { useUnits } from './UnitsContext';

/**
 * Metres or feet, switched in one tap. It used to be a globe icon opening a
 * panel, which read as a language setting and hid a two-way choice behind a
 * click.
 */
export function HeaderControls() {
  const units = useUnits();
  const imperial = units.units === 'imperial';
  return (
    <div className="units-toggle" role="radiogroup" aria-label="Units">
      <span className={`units-thumb${imperial ? ' right' : ''}`} aria-hidden="true" />
      <button type="button" role="radio" aria-checked={!imperial} className={!imperial ? 'on' : ''} onClick={() => units.setUnits('metric')} title="Metres and kilometres">
        m
      </button>
      <button type="button" role="radio" aria-checked={imperial} className={imperial ? 'on' : ''} onClick={() => units.setUnits('imperial')} title="Feet and miles">
        ft
      </button>
    </div>
  );
}
