import { useEffect, useState } from 'react';
import { formatDistanceIn, formatHeight, type Units } from '../lib/units';
import { useUnits } from './UnitsContext';
import { CheckIcon } from './icons';

const CHOICES: { id: Units; title: string; detail: string }[] = [
  { id: 'metric', title: 'Metric', detail: 'Metres and kilometres' },
  { id: 'imperial', title: 'Imperial', detail: 'Feet and miles' },
];

/** Settings › Preferences: units, saved the moment they change. */
export function SettingsPreferences() {
  const { units, setUnits } = useUnits();
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  return (
    <section className="ac-card" aria-labelledby="ac-units-title">
      <div className="ac-card-head">
        <h3 id="ac-units-title">Units</h3>
        <span className="ac-ok" role="status">
          {justSaved && (
            <>
              <CheckIcon size={12} /> Saved
            </>
          )}
        </span>
      </div>
      <div className="ac-radio-cards" role="radiogroup" aria-labelledby="ac-units-title">
        {CHOICES.map((choice) => (
          <label key={choice.id} className={`ac-radio-card${units === choice.id ? ' on' : ''}`}>
            <input
              type="radio"
              name="units"
              value={choice.id}
              checked={units === choice.id}
              onChange={() => {
                setUnits(choice.id);
                setJustSaved(true);
              }}
            />
            <strong>{choice.title}</strong>
            <span>{choice.detail}</span>
            <small>
              {formatHeight(1250, choice.id)} · {formatDistanceIn(12400, choice.id)}
            </small>
          </label>
        ))}
      </div>
      <p className="ac-help">The m / ft switch in the header changes this same setting.</p>
    </section>
  );
}
