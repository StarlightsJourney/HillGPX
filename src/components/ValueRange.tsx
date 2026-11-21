import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  binCount,
  buildScale,
  histogram,
  neighbourStop,
  positionOf,
  ridgeHeights,
  ridgePath,
  smooth,
  stopAt,
  type RangeKind,
} from '../lib/rangeScale';

export interface ValueRangeProps {
  /** The pool the scale and silhouette are built from, in the slider's own unit. */
  values: number[];
  /**
   * The part of `values` that passes every other filter. The axis stays built
   * from `values` (so handles never move by themselves); this drives the solid
   * shape, and the rest of the pool shows as a faint ghost. Omit to show all.
   */
  matching?: number[];
  min: number | null;
  max: number | null;
  /** How this kind of bound is labelled, typed and rounded. */
  kind: RangeKind;
  /** aria-labels for the two handles and fields, e.g. "Minimum distance". */
  minLabel: string;
  maxLabel: string;
  onChange: (min: number | null, max: number | null) => void;
}

/**
 * A range filter: a silhouette of what is out there, two handles to drag, and
 * two fields to type a minimum and a maximum into. A bound at an end of the
 * track means "no bound" (null); a typed bound can lie beyond the top.
 */
export function ValueRange({ values, matching, min, max, kind, minLabel, maxLabel, onChange }: ValueRangeProps) {
  const scale = useMemo(() => buildScale(values, kind.steps), [values, kind]);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'min' | 'max' | null>(null);

  // Derived from the filters every render rather than held here as well. Two
  // copies of the same number is how "Clear all" ends up moving the pins but
  // leaving the handles where they were.
  const minValue = min ?? 0;
  const maxValue = max ?? scale.hi;
  const minPos = positionOf(minValue, scale);
  const maxPos = positionOf(maxValue, scale);
  const lastStop = scale.stops.length - 1;

  /** Report two stop values as bounds, the ends meaning "no bound". */
  const commitStops = (lower: number, upper: number) => {
    const lo = Math.min(lower, upper);
    const hi = Math.max(lower, upper);
    onChange(lo <= 0 ? null : lo, hi >= scale.hi ? null : hi);
  };

  const stopFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return scale.stops[stopAt((clientX - rect.left) / rect.width, scale)];
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const at = stopFromClientX(e.clientX);
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]');
    // Whichever handle is nearer, so a press on bare track drags the one you
    // meant instead of always the lower one.
    const grabbed =
      handle?.dataset.handle === 'max' ? 'max'
      : handle?.dataset.handle === 'min' ? 'min'
      : Math.abs(at - minValue) <= Math.abs(at - maxValue) ? 'min' : 'max';
    dragging.current = grabbed;
    e.currentTarget.querySelector<HTMLElement>(`[data-handle="${grabbed}"]`)?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (grabbed === 'min') commitStops(Math.min(at, maxValue), maxValue);
    else commitStops(minValue, Math.max(at, minValue));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const at = stopFromClientX(e.clientX);
    if (dragging.current === 'min') commitStops(Math.min(at, maxValue), maxValue);
    else commitStops(minValue, Math.max(at, minValue));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onHandleKey = (which: 'min' | 'max') => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = which === 'min' ? minValue : maxValue;
    const direction: 1 | -1 | 0 = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    let next: number | null;
    if (direction) next = neighbourStop(current, direction, scale);
    else if (e.key === 'PageUp') next = scale.stops[Math.min(lastStop, nearestIndex(current) + 5)];
    else if (e.key === 'PageDown') next = scale.stops[Math.max(0, nearestIndex(current) - 5)];
    else if (e.key === 'Home') next = which === 'min' ? 0 : minValue;
    else if (e.key === 'End') next = which === 'min' ? maxValue : scale.hi;
    else return;
    e.preventDefault();
    if (next == null) return;
    if (which === 'min') commitStops(Math.min(next, maxValue), maxValue);
    else commitStops(minValue, Math.max(next, minValue));
  };
  const nearestIndex = (value: number) => stopAt(positionOf(value, scale), scale);

  /** A bound typed into a field. False when it was not understood, so the field can say so. */
  const commitTyped = (which: 'min' | 'max', text: string): boolean => {
    const cleared = text.trim() === '';
    if (cleared) {
      onChange(which === 'min' ? null : min, which === 'max' ? null : max);
      return true;
    }
    const value = kind.fromField(text);
    if (value == null) return false;
    if (which === 'min') {
      // Zero is no minimum. A minimum above the maximum takes the maximum up with it.
      onChange(value <= 0 ? null : value, max != null && value > max ? value : max);
      return true;
    }
    if (value <= 0) return false;
    onChange(min != null && value < min ? value : min, value);
    return true;
  };

  // The silhouette: the whole pool as a faint ghost, what passes the other
  // filters over it, and the part of that between the handles in colour.
  const shape = useMemo(() => {
    const pool = smooth(histogram(values, scale));
    const tallest = Math.max(0, ...pool);
    const matched = matching ? smooth(histogram(matching, scale)) : pool;
    return {
      pool: ridgePath(ridgeHeights(pool, tallest)),
      matched: ridgePath(ridgeHeights(matched, tallest)),
      bins: binCount(scale),
    };
  }, [values, matching, scale]);

  const minShown = kind.toField(minValue);
  const maxShown = max == null ? `${kind.toField(scale.hi)}${scale.truncated ? '+' : ''}` : kind.toField(max);

  return (
    <div className="range">
      <div className="range-hist" aria-hidden="true">
        <svg className="range-shape range-shape-pool" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d={shape.pool} />
        </svg>
        <svg className="range-shape range-shape-out" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d={shape.matched} />
        </svg>
        <svg
          className="range-shape range-shape-in"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ clipPath: `inset(0 ${(1 - maxPos) * 100}% 0 ${minPos * 100}%)` }}
        >
          <path d={shape.matched} />
        </svg>
      </div>

      <div
        className="range-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="range-fill" style={{ left: `${minPos * 100}%`, right: `${(1 - maxPos) * 100}%` }} />
        <div
          className="range-handle"
          data-handle="min"
          style={{ left: `${minPos * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label={minLabel}
          aria-valuemin={0}
          aria-valuemax={maxValue}
          aria-valuenow={minValue}
          aria-valuetext={kind.label(minValue)}
          onKeyDown={onHandleKey('min')}
        />
        <div
          className="range-handle"
          data-handle="max"
          style={{ left: `${maxPos * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label={maxLabel}
          aria-valuemin={minValue}
          aria-valuemax={scale.hi}
          aria-valuenow={maxValue}
          aria-valuetext={max == null ? `${kind.label(scale.hi)} or more` : kind.label(maxValue)}
          onKeyDown={onHandleKey('max')}
        />
      </div>

      <div className="range-scale" aria-hidden="true">
        <span>{kind.label(0)}</span>
        <span>{kind.label(scale.hi)}{scale.truncated ? '+' : ''}</span>
      </div>

      <div className="range-fields">
        <RangeField
          caption="Minimum"
          inputLabel={minLabel}
          shown={minShown}
          unit={kind.unit}
          onCommit={(text) => commitTyped('min', text)}
        />
        <RangeField
          caption="Maximum"
          inputLabel={maxLabel}
          shown={maxShown}
          unit={kind.unit}
          onCommit={(text) => commitTyped('max', text)}
        />
      </div>
    </div>
  );
}

interface RangeFieldProps {
  caption: string;
  inputLabel: string;
  /** What the field shows at rest ("12.5", or "80+" for no maximum). */
  shown: string;
  unit: string;
  /** Apply what was typed. False when it was not understood. */
  onCommit: (text: string) => boolean;
}

/**
 * One typed bound. It shows the filter's own value until picked up; what is typed
 * is held only until Enter or leaving the field, then the value comes back from
 * the filter again (so a rejected entry simply returns to what it was).
 */
function RangeField({ caption, inputLabel, shown, unit, onCommit }: RangeFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const finish = () => {
    if (text !== null && text.trim() !== shown) setInvalid(!onCommit(text));
    setText(null);
  };

  return (
    <label className={`range-field${invalid ? ' invalid' : ''}`}>
      <span className="range-field-label">{caption}</span>
      <span className="range-field-box">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={inputLabel}
          aria-invalid={invalid || undefined}
          value={text ?? shown}
          onFocus={(e) => {
            setInvalid(false);
            // It starts as exactly what is shown, so picking it up changes nothing under the caret.
            setText(shown);
            const input = e.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onChange={(e) => {
            setInvalid(false);
            setText(e.target.value);
          }}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish();
              e.currentTarget.select();
            } else if (e.key === 'Escape' && text !== null) {
              // Put the value back, and keep the dialog open: this Escape was for the field.
              e.stopPropagation();
              setText(null);
              setInvalid(false);
            }
          }}
        />
        {unit && <span className="range-field-unit" aria-hidden="true">{unit}</span>}
      </span>
    </label>
  );
}
