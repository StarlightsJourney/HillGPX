import { useEffect, useRef, useState } from 'react';
import { routeLink } from '../lib/routes';
import type { Route } from '../types';
import { CheckIcon, CopyIcon, MailIcon, ShareIcon } from './icons';
import { Modal } from './Modal';
import { useUnits } from './UnitsContext';

interface ShareRouteDialogProps {
  route: Route;
  /** The EG the panel shows, or null when the route's elevation is not known. */
  gainM: number | null;
  onClose: () => void;
}

/**
 * "Share this route": the route, then the ways to pass its link on. Copy link
 * is always there; the phone's own share sheet is offered when the browser has
 * one; email works everywhere. The link carries no tracking parameters.
 */
export function ShareRouteDialog({ route, gainM, onClose }: ShareRouteDialogProps) {
  const units = useUnits();
  const url = routeLink(route.slug);
  const stats = `${units.distance(route.distanceM)}${gainM != null ? ` · ${units.height(gainM)} EG` : ''}`;
  const text = `${route.name}: ${units.distance(route.distanceM)}${gainM != null ? `, ${units.height(gainM)} elevation gain` : ''} on HillGPX`;
  const [copied, setCopied] = useState(false);
  // Copying can be blocked: show the link to copy by hand.
  const [manual, setManual] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setManual(false);
      setCopied(true);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setManual(true);
    }
  };

  const shareSheet = () => {
    // Cancelling the sheet is not an error.
    void navigator.share({ title: route.name, text, url }).then(onClose, () => undefined);
  };

  return (
    <Modal title="Share this route" onClose={onClose}>
      <div className="share-route">
        <p className="share-route-name">{route.name}</p>
        <p className="share-route-stats">{stats}</p>
      </div>
      <ul className="share-rows">
        <li>
          <button type="button" className="share-row" onClick={() => void copy()}>
            <span className="share-row-icon">{copied ? <CheckIcon size={20} /> : <CopyIcon size={20} />}</span>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </li>
        {typeof navigator.share === 'function' && (
          <li>
            <button type="button" className="share-row" onClick={shareSheet}>
              <span className="share-row-icon"><ShareIcon size={20} /></span>
              More options
            </button>
          </li>
        )}
        <li>
          <a className="share-row" href={`mailto:?subject=${encodeURIComponent(route.name)}&body=${encodeURIComponent(`${text}\n${url}`)}`}>
            <span className="share-row-icon"><MailIcon size={20} /></span>
            Email
          </a>
        </li>
      </ul>
      {manual && (
        <label className="share-manual">
          <span>Copy this link</span>
          <input
            readOnly
            value={url}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      <span className="visually-hidden" role="status">{copied ? 'Link copied' : ''}</span>
    </Modal>
  );
}
