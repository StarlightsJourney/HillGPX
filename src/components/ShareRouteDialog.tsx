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
  const canShare = typeof navigator.share === 'function';
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
      {/* One main action in the brand colour, the rest as quiet pills. */}
      <div className="share-pills">
        {canShare && (
          <button type="button" className="btn btn-accent share-pill share-pill-main" onClick={shareSheet}>
            <ShareIcon size={18} />
            Share
          </button>
        )}
        <button
          type="button"
          className={`btn share-pill ${canShare ? 'share-pill-quiet' : 'btn-accent share-pill-main'}`}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <a
          className="btn share-pill share-pill-quiet"
          href={`mailto:?subject=${encodeURIComponent(route.name)}&body=${encodeURIComponent(`${text}\n${url}`)}`}
        >
          <MailIcon size={18} />
          Email
        </a>
      </div>
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
