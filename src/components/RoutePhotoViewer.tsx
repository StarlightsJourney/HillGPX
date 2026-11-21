import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RoutePhoto } from '../lib/api';
import { requestReport } from '../lib/contribute';
import { lockPageScroll } from '../lib/dom';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, UserIcon } from './icons';
import { FadeImage } from './FadeImage';

interface RoutePhotoViewerProps {
  /** Every photo and hazard on the open route, in the order they step through. */
  photos: RoutePhoto[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/** Farthest a finger must travel sideways to count as a swipe to the next photo. */
const SWIPE_PX = 50;

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The photo of a route, full screen: the picture whole over a blurred copy of
 * itself, who added it and when at the top left, its caption at the bottom,
 * and the rest of the route's photos a step away. Escape, the arrow keys and a
 * swipe all work; it hands focus back to where it came from when it closes.
 */
export function RoutePhotoViewer({ photos, index, onIndex, onClose }: RoutePhotoViewerProps) {
  const count = photos.length;
  const current = photos[Math.min(Math.max(0, index), count - 1)];
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const step = (by: number) => onIndex((index + by + count) % count);

  useEffect(() => lockPageScroll(), []);

  // Focus goes in, and comes back out to what opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    // Captured on window, ahead of the dialogs underneath: Escape closes only this.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (menuOpen) setMenuOpen(false);
        else onClose();
      } else if (event.key === 'ArrowRight' && count > 1) {
        event.stopPropagation();
        step(1);
      } else if (event.key === 'ArrowLeft' && count > 1) {
        event.stopPropagation();
        step(-1);
      } else if (event.key === 'Tab') {
        // Keep Tab inside the viewer.
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // The next and the previous photo are fetched while this one is looked at.
  useEffect(() => {
    if (count < 2) return;
    for (const by of [1, -1]) {
      const image = new Image();
      image.src = photos[(index + by + count) % count].url;
    }
  }, [index, count, photos]);

  if (!current) return null;
  const date = new Date(current.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return createPortal(
    <div
      className="rpv"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={current.caption ? `Photo: ${current.caption}` : 'Route photo'}
      onTouchStart={(event) => {
        swipeFrom.current = event.touches.length === 1 ? event.touches[0].clientX : null;
      }}
      onTouchEnd={(event) => {
        const from = swipeFrom.current;
        swipeFrom.current = null;
        if (from == null || count < 2) return;
        const moved = event.changedTouches[0].clientX - from;
        if (Math.abs(moved) >= SWIPE_PX) step(moved < 0 ? 1 : -1);
      }}
    >
      <div className="rpv-backdrop" style={{ backgroundImage: `url("${current.url}")` }} aria-hidden="true" />

      <header className="rpv-head">
        <span className="rpv-avatar" aria-hidden="true"><UserIcon size={18} /></span>
        <span className="rpv-who">
          <strong>{current.author}</strong>
          <span>{date}</span>
        </span>
        <div className="rpv-actions">
          <div className="rpv-menu">
            <button
              type="button"
              className="rpv-round rpv-more"
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">•••</span>
            </button>
            {menuOpen && (
              <div className="rpv-menu-list" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onClose();
                    requestReport({ targetType: 'route_photo', targetSlug: current.id, targetName: current.caption || 'this photo' });
                  }}
                >
                  Report this photo
                </button>
              </div>
            )}
          </div>
          <button type="button" className="rpv-round rpv-close" ref={closeRef} aria-label="Close photo" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
      </header>

      <div className="rpv-stage" onClick={(event) => event.target === event.currentTarget && onClose()}>
        <FadeImage key={current.id} className="rpv-img" src={current.url} alt={current.caption || 'Photo along the route'} decoding="async" />
      </div>

      {count > 1 && (
        <>
          <button type="button" className="rpv-arrow prev" aria-label="Previous photo" onClick={() => step(-1)}><ChevronLeftIcon size={20} /></button>
          <button type="button" className="rpv-arrow next" aria-label="Next photo" onClick={() => step(1)}><ChevronRightIcon size={20} /></button>
        </>
      )}

      <footer className="rpv-foot">
        <p className="rpv-caption">
          {current.kind === 'hazard' && <span className="rpv-tag">Hazard</span>}
          {current.caption}
        </p>
        {count > 1 && <span className="rpv-count" aria-live="polite">{Math.min(index, count - 1) + 1} / {count}</span>}
      </footer>
    </div>,
    document.body,
  );
}
