import { useEffect, useRef, useState } from 'react';
import { CloseIcon, LocationArrowIcon } from './icons';
import { prefersReducedMotion } from '../lib/dom';
import type { LocateHint } from '../lib/geolocation';

/** How long an informational note stays before it closes by itself. */
export const NOTE_AUTO_CLOSE_MS = 6000;

interface LocateNoteProps {
  hint: LocateHint;
  /** Tapping a note about a location problem asks again. */
  onRetry: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * The note over the map saying why it shows what it shows. A note that only
 * informs (`retry: null`) closes itself after `NOTE_AUTO_CLOSE_MS`, paused
 * while the pointer is over it or it holds focus; the map page also closes it
 * on the visitor's first pan or zoom. A location problem that can be tapped to
 * ask again stays until it is dismissed or tapped.
 */
export function LocateNote({ hint, onRetry, onDismiss }: LocateNoteProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  // Time left on the countdown, carried across pauses; a new note starts over.
  const remainingRef = useRef(NOTE_AUTO_CLOSE_MS);
  const countedRef = useRef<LocateHint | null>(null);

  const paused = hovered || focused;
  const autoClose = hint.retry === null;

  useEffect(() => {
    if (countedRef.current !== hint) {
      countedRef.current = hint;
      remainingRef.current = NOTE_AUTO_CLOSE_MS;
      setLeaving(false);
    }
    if (!autoClose || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => {
      if (prefersReducedMotion()) onDismissRef.current();
      else setLeaving(true);
    }, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - started));
    };
  }, [hint, autoClose, paused]);

  return (
    <div
      className={`locate-hint${hint.retry ? ' retry' : ''}${leaving ? ' leaving' : ''}`}
      role="status"
      onClick={onRetry}
      onPointerEnter={() => {
        setHovered(true);
        setLeaving(false);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onDismissRef.current();
      }}
    >
      <span className="locate-hint-icon" aria-hidden="true">
        <LocationArrowIcon size={22} />
      </span>
      <div className="locate-hint-body">
        <p className="locate-hint-title">{hint.title}</p>
        <p className="locate-hint-text">{hint.text}</p>
      </div>
      <button
        type="button"
        className="locate-hint-close"
        aria-label="Dismiss location hint"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
