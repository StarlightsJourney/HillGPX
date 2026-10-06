import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { Route } from '../types';
import { haversineM } from '../lib/elevation';
import { loadAuthor, saveAuthor, submitRoutePhoto, type RoutePhoto } from '../lib/api';
import { Modal } from './Modal';
import { useUnits } from './UnitsContext';

/**
 * Pin a photo or a hazard to a point along a route. The point is picked with
 * a slider over the route's distance — the map dot follows it — starting from
 * wherever you last hovered the elevation profile.
 */
export function RoutePhotoModal({ route, startIndex, onPreviewIndex, onClose, onAdded }: { route: Route; startIndex: number; onPreviewIndex: (index: number | null) => void; onClose: () => void; onAdded: (photo: RoutePhoto) => void }) {
  const units = useUnits();
  const [index, setIndex] = useState(startIndex);
  const [kind, setKind] = useState<'photo' | 'hazard'>('photo');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [author, setAuthor] = useState(loadAuthor);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const send = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    saveAuthor(author);
    const [lng, lat] = route.coordinates[index];
    try {
      onAdded(await submitRoutePhoto({ routeSlug: route.slug, lng, lat, kind, caption, file, author }));
      setDone(true);
    } catch (err) {
      setError(`Could not upload: ${(err as Error).message}`);
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
          <label className="field">
            <span>Where along the route · {units.distance(distances[index])} · {units.height(point[2])}</span>
            <input className="route-photo-slider" type="range" min={0} max={route.coordinates.length - 1} value={index} onChange={(event) => setIndex(Number(event.target.value))} />
          </label>
          <label className="photo-upload">
            {preview ? <img src={preview} alt="" /> : <><strong>Choose a photo</strong><span>{kind === 'hazard' ? 'Show the problem: landslip, fallen tree, broken steps…' : 'A view, a junction, a water point — whatever helps the next person.'}</span></>}
            <input type="file" accept="image/*" onChange={choose} />
          </label>
          <label className="field">
            <span>{kind === 'hazard' ? 'What is the hazard?' : 'Caption (optional)'}</span>
            <input value={caption} maxLength={280} onChange={(event) => setCaption(event.target.value)} placeholder={kind === 'hazard' ? 'Fallen tree blocks the trail after the bridge' : 'Water point at the shelter'} />
          </label>
          <label className="field">
            <span>Credit as (optional)</span>
            <input value={author} maxLength={60} onChange={(event) => setAuthor(event.target.value)} placeholder="Your name or handle" />
          </label>
          <p className="photo-note">Appears straight away under the <a href="#terms">house rules</a>; anything reported by several people is hidden. Location data is removed from the file.</p>
          {error && <p className="review-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
