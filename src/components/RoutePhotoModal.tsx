import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { Route } from '../types';
import { haversineM } from '../lib/elevation';
import { nearestPointOnRoute } from '../lib/routes';
import { locate, locationProblemText } from '../lib/geolocation';
import { errorText, submitRoutePhoto, type RoutePhoto } from '../lib/api';
import { useAuthUser } from '../lib/auth';
import { CreditChips } from './CreditChips';
import { LocateIcon } from './icons';
import { Modal } from './Modal';
import { useUnits } from './UnitsContext';

/** What "Use my location" found: placed on the route, or why not. */
type LocateNote = { tone: 'ok' | 'warn'; text: string };

/** Phones and tablets: offer the camera directly, not just the photo library. */
const TOUCH = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Pin a photo or a hazard to a point along a route. "Use my location" snaps
 * it to the route point nearest the runner; otherwise the point is picked
 * with a slider over the route's distance — the map dot follows it — starting
 * from wherever you last hovered the elevation profile.
 */
export function RoutePhotoModal({ route, startIndex, onPreviewIndex, onClose, onAdded }: { route: Route; startIndex: number; onPreviewIndex: (index: number | null) => void; onClose: () => void; onAdded: (photo: RoutePhoto) => void }) {
  const units = useUnits();
  const [index, setIndex] = useState(startIndex);
  const [kind, setKind] = useState<'photo' | 'hazard'>('photo');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const user = useAuthUser();
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<LocateNote | null>(null);

  const distances = useMemo(() => {
    const out = [0];
    const pts = route.coordinates;
    for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    return out;
  }, [route.coordinates]);

  useEffect(() => {
    onPreviewIndex(index);
  }, [index, onPreviewIndex]);
  useEffect(() => () => onPreviewIndex(null), [onPreviewIndex]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  };

  // The position never leaves the browser: only the route point it snaps to is sent.
  const locateMe = () => {
    setLocating(true);
    setLocateNote(null);
    locate(
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      (here) => {
        setLocating(false);
        const hit = nearestPointOnRoute(route, here.lng, here.lat);
        if (hit.onRoute) {
          setIndex(hit.index);
          setLocateNote({ tone: 'ok', text: `Placed where you are, ${units.distance(distances[hit.index])} along the route.` });
        } else {
          setLocateNote({ tone: 'warn', text: `You don’t seem to be on this route: you are ${units.distance(hit.distanceM)} from it. Place it with the slider instead.` });
        }
      },
      (problem) => {
        setLocating(false);
        const text = locationProblemText(problem, 'Location is blocked for this site. Allow it in your browser settings, or place it with the slider.');
        setLocateNote({
          tone: 'warn',
          text: problem === 'denied' ? text : `${text} ${problem === 'unsupported' ? 'Place it with the slider instead.' : 'Try again, or place it with the slider.'}`,
        });
      },
    );
  };

  const send = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const [lng, lat] = route.coordinates[index];
    try {
      onAdded(await submitRoutePhoto({ routeSlug: route.slug, lng, lat, kind, caption, file, author: user && !anonymous ? user.username : '' }));
      setDone(true);
    } catch (err) {
      setError(`Could not upload: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const point = route.coordinates[index];
  return (
    <Modal
      title={`Add to ${route.name}`}
      onClose={onClose}
      footer={done ? (
        <button type="button" className="btn btn-dark" onClick={onClose}>Done</button>
      ) : (
        <button type="button" className="btn btn-accent" disabled={!file || busy} onClick={() => void send()}>
          {busy ? 'Uploading…' : kind === 'hazard' ? 'Report hazard' : 'Add photo'}
        </button>
      )}
    >
      {done ? (
        <p className="review-thanks">Added. It is on the route for everyone now.</p>
      ) : (
        <div className="photo-form">
          <div className="chip-row" role="radiogroup" aria-label="What is it">
            <button type="button" role="radio" aria-checked={kind === 'photo'} className={`chip${kind === 'photo' ? ' on' : ''}`} onClick={() => setKind('photo')}>Photo</button>
            <button type="button" role="radio" aria-checked={kind === 'hazard'} className={`chip${kind === 'hazard' ? ' on' : ''}`} onClick={() => setKind('hazard')}>Hazard</button>
          </div>
          <div className="route-photo-where">
            <button type="button" className="btn btn-light btn-sm route-photo-locate" disabled={locating} onClick={locateMe}>
              <LocateIcon size={16} />
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
            {locateNote && <p className={`route-photo-locate-note ${locateNote.tone}`} role="status">{locateNote.text}</p>}
            <label className="field">
              <span>Where along the route · {units.distance(distances[index])} · {units.height(point[2])}</span>
              <input className="route-photo-slider" type="range" min={0} max={route.coordinates.length - 1} value={index} onChange={(event) => setIndex(Number(event.target.value))} />
            </label>
          </div>
          <label className="photo-upload">
            {preview ? <img src={preview} alt="" /> : <><strong>Choose a photo</strong><span>{kind === 'hazard' ? 'Show the problem: landslip, fallen tree, broken steps…' : 'A view, a junction, a water point — whatever helps the next person.'}</span></>}
            <input type="file" accept="image/*" onChange={choose} />
          </label>
          {TOUCH && (
            <label className="btn btn-light btn-sm route-photo-camera">
              Take a photo
              <input type="file" accept="image/*" capture="environment" onChange={choose} />
            </label>
          )}
          <label className="field">
            <span>{kind === 'hazard' ? 'What is the hazard?' : 'Caption (optional)'}</span>
            <input value={caption} maxLength={280} onChange={(event) => setCaption(event.target.value)} placeholder={kind === 'hazard' ? 'Fallen tree blocks the trail after the bridge' : 'Water point at the shelter'} />
          </label>
          {user ? (
            <CreditChips username={user.username} anonymous={anonymous} onChange={setAnonymous} />
          ) : (
            <p className="photo-note">Uploaded anonymously — sign in to credit your username.</p>
          )}
          <p className="photo-note">Appears straight away under the <a href="#terms">house rules</a>; anything reported by several people is hidden. Location data is removed from the file.</p>
          {error && <p className="review-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
