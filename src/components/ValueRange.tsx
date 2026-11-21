import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { buildScale, histogram, neighbourStop, positionOf, stopAt, type RangeKind } from '../lib/rangeScale';

export interface ValueRangeProps {
  /** The pool the scale and silhouette are built from, in the slider's own unit. */
  values: number[];
  /**
   * The part of `values` that passes every other filter. The axis stays built
   * from `values` (so handles never move by themselves); these drive the solid
   * bars, and the rest of each bucket shows as a faint ghost. Omit to show all.
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
 * A range filter: a histogram of what is out there, two handles to drag, and
 * two fields to type a minimum and a maximum into. A bound at an end of the
 * track means "no bound" (null); a typed bound can lie beyond the top.
 */
export function ValueRange({ values, matching, min, max, kind, minLabel, maxLabel, onChange }: ValueRangeProps) {
  const scale = useMemo(() => buildScale(values), [values]);
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
  const commitTyped = (which: 'min' | 'max', typed: string): boolean => {
    // "85 km+" is how no maximum is shown; the plus is not part of the number.
    const text = typed.replace(/\+\s*$/, '');
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

  const counts = useMemo(() => histogram(values, scale), [values, scale]);
  const matchCounts = useMemo(() => (matching ? histogram(matching, scale) : counts), [matching, scale, counts]);
  const tallest = Math.max(1, ...counts);

  // What each field shows, unit and all: "0 km", "85 km+" for no maximum.
  const minShown = kind.label(minValue);
  const maxShown = max == null ? `${kind.label(scale.hi)}+` : kind.label(max);

  return (
    <div className="range">
      <div className="range-hist" aria-hidden="true">
        {counts.map((count, i) => {
          const start = i * scale.step;
          const end = (i + 1) * scale.step;
          return (
            <div
              key={i}
              className={`range-bar${end >= minValue && start <= maxValue ? ' in' : ''}`}
              // Square-rooted, not proportional. The busiest bucket holds thousands
              // of venues and the quietest a handful; drawn to scale the tail would
              // be a one-pixel line, and the tail is the half of the range someone
              // opening this control is trying to see into.
              style={{ height: `${Math.max(3, 100 * Math.sqrt(count / tallest))}%` }}
            >
              <div
                className="range-bar-match"
                style={{ height: `${matchCounts[i] === 0 ? 0 : Math.max(3, 100 * Math.sqrt(matchCounts[i] / count))}%` }}
              />
            </div>
          );
        })}
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

      <div className="range-scale small muted" aria-hidden="true">
        <span>{kind.label(scale.lo)}</span>
        <span>{scale.truncated ? `${kind.label(scale.hi)}+` : kind.label(scale.hi)}</span>
      </div>

      <div className="range-fields">
        <RangeField
          caption="Minimum"
          inputLabel={minLabel}
          inputMode={kind.inputMode}
          shown={minShown}
          onCommit={(text) => commitTyped('min', text)}
        />
        <RangeField
          caption="Maximum"
          inputLabel={maxLabel}
          inputMode={kind.inputMode}
          shown={maxShown}
          onCommit={(text) => commitTyped('max', text)}
        />
      </div>
    </div>
  );
}

interface RangeFieldProps {
  caption: string;
  inputLabel: string;
  /** The keypad a phone shows: numbers only, or full text where units and "1h30" are typed. */
  inputMode: 'decimal' | 'text';
  /** What the field shows at rest ("12.5 km", or "80 km+" for no maximum). */
  shown: string;
  /** Apply what was typed. False when it was not understood. */
  onCommit: (text: string) => boolean;
}

/**
 * One typed bound. It shows the filter's own value until picked up; what is typed
 * is held only until Enter or leaving the field, then the value comes back from
 * the filter again (so a rejected entry simply returns to what it was).
 */
function RangeField({ caption, inputLabel, inputMode, shown, onCommit }: RangeFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const finish = () => {
    if (text !== null && text.trim() !== shown) setInvalid(!onCommit(text));
    setText(null);
  };

  return (
    <label className={`range-field${invalid ? ' invalid' : ''}`}>
      <span className="range-field-label">{caption}</span>
      <input
        type="text"
        inputMode={inputMode}
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
    </label>
  );
}
