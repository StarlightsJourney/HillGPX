import { useState } from 'react';
import { errorText, submitPlaceSuggestion } from '../lib/api';
import { useAuthUser } from '../lib/auth';
import { locate, NEAR_ME_OPTIONS } from '../lib/geolocation';
import type { VenueType } from '../types';
import { Modal } from './Modal';

const TYPES: { value: VenueType; label: string }[] = [
  { value: 'hill', label: 'Hill or mountain' },
  { value: 'stairs', label: 'Stairs' },
  { value: 'hdb_block', label: 'Tall block' },
  { value: 'park', label: 'Park' },
  { value: 'carpark', label: 'Carpark' },
  { value: 'bridge', label: 'Bridge' },
];

const num = (text: string, min: number, max: number) => {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) && value >= min && value <= max;
};

/**
 * Suggest a place that is missing, from the footer's "Add a missing place".
 * It lands in the moderators' report queue like a contact message; a wrong
 * height is worse than a gap, so the numbers can be left blank.
 */
export function AddPlaceModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<VenueType>('hill');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [gainM, setGainM] = useState('');
  const [summitM, setSummitM] = useState('');
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState('');
  const [locating, setLocating] = useState(false);
  const user = useAuthUser();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    !busy &&
    name.trim().length >= 2 &&
    num(lat, -90, 90) &&
    num(lng, -180, 180) &&
    source.trim().length >= 3 &&
    (gainM.trim() === '' || num(gainM, 1, 9000)) &&
    (summitM.trim() === '' || num(summitM, 0, 9000));

  const useMyLocation = () => {
    setLocating(true);
    locate(
      NEAR_ME_OPTIONS,
      (here) => {
        setLat(here.lat.toFixed(5));
        setLng(here.lng.toFixed(5));
        setLocating(false);
      },
      () => setLocating(false),
    );
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitPlaceSuggestion({ name, type, lat, lng, gainM, summitM, source, notes, author: user?.username ?? '' });
      setSent(true);
    } catch (err) {
      setError(`Could not send: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a missing place"
      onClose={onClose}
      footer={
        sent ? (
          <button type="button" className="btn btn-dark" onClick={onClose}>
            Done
          </button>
        ) : (
          <button type="button" className="btn btn-dark" disabled={!ready} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Suggest it'}
          </button>
        )
      }
    >
      {sent ? (
        <p className="review-thanks">Thank you — a moderator will check the details and add it to the map.</p>
      ) : (
        <div className="report-form contact-form add-place-form">
          <p className="add-place-note">
            Public places only — if access is gated or restricted, say so in the notes. Leave a number blank rather than
            guessing; a wrong height is worse than a gap.
          </p>
          <label className="field">
            Name
            <input type="text" maxLength={80} placeholder="Bukit Timah Hill" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="field">
            Type
            <div className="chip-row" role="radiogroup" aria-label="Type of place">
              {TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={type === option.value}
                  className={`report-kind place-type${type === option.value ? ' on' : ''}`}
                  onClick={() => setType(option.value)}
                >
                  <strong>{option.label}</strong>
                </button>
              ))}
            </div>
          </div>
          <div className="add-place-coords">
            <label className="field">
              Latitude
              <input type="text" inputMode="decimal" placeholder="1.3546" value={lat} onChange={(event) => setLat(event.target.value)} />
            </label>
            <label className="field">
              Longitude
              <input type="text" inputMode="decimal" placeholder="103.7764" value={lng} onChange={(event) => setLng(event.target.value)} />
            </label>
          </div>
          <button type="button" className="add-place-locate" disabled={locating} onClick={useMyLocation}>
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          <div className="add-place-coords">
            <label className="field">
              Height gain (m, optional)
              <input type="text" inputMode="decimal" placeholder="Climbed from the usual start" value={gainM} onChange={(event) => setGainM(event.target.value)} />
            </label>
            <label className="field">
              Summit elevation (m, optional)
              <input type="text" inputMode="decimal" placeholder="Above sea level" value={summitM} onChange={(event) => setSummitM(event.target.value)} />
            </label>
          </div>
          <label className="field">
            Source for the numbers
            <textarea
              className="review-comment"
              rows={2}
              maxLength={400}
              placeholder="A link, a survey or map reference, or how you measured it"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
          </label>
          <label className="field">
            Access notes (optional)
            <textarea
              className="review-comment"
              rows={2}
              maxLength={400}
              placeholder="Opening hours, gates, where to start"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {error && <p className="review-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
