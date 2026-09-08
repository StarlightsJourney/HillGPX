import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useUnits } from './UnitsContext';
import { CloseIcon } from './icons';
import type { Venue, VenueType } from '../types';
import {
  NO_FILTERS,
  VENUE_TYPE_LABEL,
  activeFilterCount,
  formatCount,
  rankingHeight,
  type VenueFilters,
} from '../lib/venues';

interface FilterBarProps {
  /** The types present in the data, so no chip is offered that returns nothing. */
  types: VenueType[];
  /**
   * Venues inside the current map viewport. The height histogram and counts are
   * drawn from these so the filters always describe the area on screen.
   */
  visibleVenues: Venue[];
  filters: VenueFilters;
  onChange: (filters: VenueFilters) => void;
  /** How many venues in the current viewport survive the current filters. */
  matchCount: number;
}

/**
 * The chip row under the search bar, and the Filters dialog behind it.
 *
 * Every control here is a question the data can answer. The obvious absentee is
 * routes: `routeSlugs` is empty on all 11,922 venues in the current file, so a
 * "has a route" chip would be a control that is always wrong to press. Town is
 * the other one left out — it is populated, but 200-odd towns is a dropdown,
 * not a row of pills, and it answers "where" which the map already is.
 *
 * The row keeps the toggles worth reaching for one-handed; everything that needs
 * room to be understood — the type choice, the height distribution — lives in
 * the dialog.
 */
function FilterBarInner({ types, visibleVenues, filters, onChange, matchCount }: FilterBarProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  const count = activeFilterCount(filters);

  const toggleType = (type: VenueType) =>
    onChange({
      ...filters,
      types: filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type],
    });

  const clearAll = () => onChange(NO_FILTERS);

  return (
    <div className="filterbar">
      <div className="filterbar-row">
        <button
          type="button"
          ref={openerRef}
          className={`filter-open${count > 0 ? ' on' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={modalOpen}
          onClick={() => setModalOpen(true)}
        >
          <SlidersIcon />
          Filters
          {count > 0 && <span className="filter-badge">{count}</span>}
        </button>

        <span className="filterbar-divider" aria-hidden="true" />

        {/* The height chips that used to sit here are gone: height is a range
            now, and a "30 m+" pill beside a slider that says 30–2187 is the same
            fact stated twice, in a place where the two could visibly disagree. */}
        <div className="filter-chips">
          {types.map((type) => (
            <Chip key={type} active={filters.types.includes(type)} onClick={() => toggleType(type)}>
              {VENUE_TYPE_LABEL[type]}
            </Chip>
          ))}

          <Chip
            active={filters.notableOnly}
            onClick={() => onChange({ ...filters, notableOnly: !filters.notableOnly })}
          >
            Top climbs
          </Chip>

          <Chip
            active={filters.withPhoto}
            onClick={() => onChange({ ...filters, withPhoto: !filters.withPhoto })}
          >
            With photo
          </Chip>
        </div>
      </div>

      {count > 0 && (
        <p className="filterbar-summary small">
          <span className="muted">
            {matchCount === 0
              ? 'No matches'
              : `${matchCount.toLocaleString()} venue${matchCount === 1 ? '' : 's'} match`}
          </span>
          <button type="button" className="linkish" onClick={clearAll}>
            Clear all
          </button>
        </p>
      )}

      {modalOpen && (
        <FilterModal
          types={types}
          visibleVenues={visibleVenues}
          filters={filters}
          onChange={onChange}
          matchCount={matchCount}
          onClose={() => setModalOpen(false)}
          returnFocusTo={openerRef}
        />
      )}
    </div>
  );
}

/* ─── The dialog ──────────────────────────────────────────────────────── */

interface FilterModalProps extends FilterBarProps {
  onClose: () => void;
  returnFocusTo: React.RefObject<HTMLElement>;
}

/**
 * Changes apply as they are made rather than on a draft the footer commits.
 *
 * The map is directly behind the dialog and only half-covered on a wide screen,
 * so dragging the height handles repaints the pins as you go — which is the
 * answer you opened the filters to get. Buffering that into a draft would trade
 * a live picture for the ability to cancel, and there is nothing here that is
 * expensive to undo: every control is one press from where it was.
 */
function FilterModal({
  types,
  visibleVenues,
  filters,
  onChange,
  matchCount,
  onClose,
  returnFocusTo,
}: FilterModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape and the focus trap are on the document rather than the dialog so
  // they still fire while a handle inside is being dragged with the pointer
  // captured, which is exactly when a stuck dialog would be most annoying.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const opener = returnFocusTo.current;
    const previousOverflow = document.body.style.overflow;
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      if (root) root.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      // Sending focus back to the button that opened this is what makes the
      // dialog dismissable from the keyboard without losing your place — after
      // Escape the caret would otherwise fall back to the top of the document.
      opener?.focus();
    };
  }, [returnFocusTo]);

  const heights = useMemo(
    () => visibleVenues.map(rankingHeight).filter((h) => h > 0),
    [visibleVenues],
  );

  const selectedType: VenueType | null = filters.types.length === 1 ? filters.types[0] : null;

  // Portalled to the body: .filterbar sits in a stacking context below the
  // topbar, so a scrim rendered in place would be painted under the search bar
  // it is supposed to cover.
  return createPortal(
    <div
      className="filter-scrim"
      // mousedown, not click: a drag that starts on a handle and ends outside
      // the dialog fires a click on the scrim, which would shut the dialog the
      // instant you overshot the end of the slider.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="filter-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-modal-title"
        ref={dialogRef}
      >
        <header className="filter-modal-head">
          <h2 id="filter-modal-title">Filters</h2>
          <button
            type="button"
            ref={closeRef}
            className="filter-modal-close"
            aria-label="Close filters"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="filter-modal-body">
          <section className="filter-group">
            <h3 id="filter-type-label">Place type</h3>
            {/* One choice: Any, or one specific type. */}
            <div className="seg" role="radiogroup" aria-labelledby="filter-type-label">
              <Segment
                selected={selectedType === null}
                onSelect={() => onChange({ ...filters, types: [] })}
              >
                Any type
              </Segment>
              {types.map((type) => (
                <Segment
                  key={type}
                  selected={selectedType === type}
                  onSelect={() => onChange({ ...filters, types: [type] })}
                >
                  {VENUE_TYPE_LABEL[type]}
                </Segment>
              ))}
            </div>
          </section>

          <section className="filter-group">
            <h3>Elevation range</h3>
            <HeightRange
              heights={heights}
              minHeightM={filters.minHeightM}
              maxHeightM={filters.maxHeightM}
              onChange={(minHeightM, maxHeightM) => onChange({ ...filters, minHeightM, maxHeightM })}
            />
          </section>
        </div>

        <footer className="filter-modal-foot">
          <button type="button" className="linkish" onClick={() => onChange(NO_FILTERS)}>
            Clear all
          </button>
          <button type="button" className="filter-apply" onClick={onClose}>
            {matchCount === 0
              ? 'No matches'
              : `Show ${formatCount(matchCount)} venue${matchCount === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Height range ────────────────────────────────────────────────────── */

/** Bars in the histogram. Twenty is the most this data supports without gaps:
 *  HDB heights are storeys × 2.8 m, so buckets narrower than that at the low
 *  end fall between two rungs of the ladder the data is actually on and come
 *  out empty, which reads as missing data rather than as a bucketing artefact. */
const BUCKETS = 20;

interface HeightScale {
  lo: number;
  hi: number;
  /** Bucket width in metres. */
  step: number;
  /** Every value a handle can stop on, ascending. */
  stops: number[];
  /** Venue counts per bucket, left to right. */
  counts: number[];
}

/** Linear height scale starting from 1 m so the histogram reads intuitively. */
function buildScale(heights: number[]): HeightScale {
  let hi = 0;
  for (const h of heights) {
    if (h > hi) hi = h;
  }
  if (hi <= 1) return { lo: 0, hi: 1, step: 1, stops: [0, 1], counts: [] };
  hi = Math.ceil(hi);
  const step = Math.max(1, Math.ceil(hi / BUCKETS));

  const stops: number[] = [0];
  for (let v = step; v <= hi; v += step) stops.push(v);
  if (stops[stops.length - 1] < hi) stops.push(hi);

  const counts = new Array(BUCKETS).fill(0);
  for (const h of heights) {
    const bucket = Math.min(BUCKETS - 1, Math.floor(h / step));
    counts[bucket] += 1;
  }

  return { lo: 0, hi, step, stops, counts };
}

/** Where a height sits along the track, 0 to 1. */
function positionOf(value: number, scale: HeightScale): number {
  return clamp(value, 0, scale.hi) / scale.hi;
}

/** The stop nearest a point on the track. */
function stopAt(ratio: number, scale: HeightScale): number {
  const target = clamp(ratio, 0, 1) * scale.hi;
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < scale.stops.length; i += 1) {
    const gap = Math.abs(scale.stops[i] - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/** The stop index holding a value already in the filters. */
function indexOfValue(value: number, scale: HeightScale): number {
  return stopAt(positionOf(clamp(value, 0, scale.hi), scale), scale);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

interface HeightRangeProps {
  heights: number[];
  minHeightM: number | null;
  maxHeightM: number | null;
  onChange: (minHeightM: number | null, maxHeightM: number | null) => void;
}

function HeightRange({ heights, minHeightM, maxHeightM, onChange }: HeightRangeProps) {
  const units = useUnits();
  const scale = useMemo(() => buildScale(heights), [heights]);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'min' | 'max' | null>(null);

  const lastIndex = scale.stops.length - 1;
  // Derived from the filters every render rather than held here as well. Two
  // copies of the same number is how "Clear all" ends up moving the pins but
  // leaving the handles where they were.
  const minIndex = minHeightM == null ? 0 : indexOfValue(minHeightM, scale);
  const maxIndex = maxHeightM == null ? lastIndex : indexOfValue(maxHeightM, scale);
  const minValue = scale.stops[minIndex];
  const maxValue = scale.stops[maxIndex];

  /** Report a pair of stop indices as filter bounds, the ends meaning "no bound". */
  const commit = (nextMin: number, nextMax: number) => {
    const lower = clamp(nextMin, 0, nextMax);
    const upper = clamp(nextMax, lower, lastIndex);
    onChange(
      lower === 0 ? null : scale.stops[lower],
      upper === lastIndex ? null : scale.stops[upper],
    );
  };

  const indexFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return stopAt((clientX - rect.left) / rect.width, scale);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const index = indexFromClientX(e.clientX);
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]');
    // Whichever handle is nearer, so a press on bare track drags the one you
    // meant instead of always the lower one.
    const grabbed = handle?.dataset.handle === 'max' ? 'max'
      : handle?.dataset.handle === 'min' ? 'min'
      : Math.abs(index - minIndex) <= Math.abs(index - maxIndex) ? 'min' : 'max';
    dragging.current = grabbed;
    e.currentTarget.querySelector<HTMLElement>(`[data-handle="${grabbed}"]`)?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (grabbed === 'min') commit(Math.min(index, maxIndex), maxIndex);
    else commit(minIndex, Math.max(index, minIndex));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const index = indexFromClientX(e.clientX);
    if (dragging.current === 'min') commit(Math.min(index, maxIndex), maxIndex);
    else commit(minIndex, Math.max(index, minIndex));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onHandleKey = (which: 'min' | 'max') => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = which === 'min' ? minIndex : maxIndex;
    let next = current;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = current + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current - 1;
    else if (e.key === 'PageUp') next = current + 5;
    else if (e.key === 'PageDown') next = current - 5;
    else if (e.key === 'Home') next = which === 'min' ? 0 : minIndex;
    else if (e.key === 'End') next = which === 'min' ? maxIndex : lastIndex;
    else return;
    e.preventDefault();
    if (which === 'min') commit(clamp(next, 0, maxIndex), maxIndex);
    else commit(minIndex, clamp(next, minIndex, lastIndex));
  };

  const tallest = Math.max(1, ...scale.counts);
  const minPos = positionOf(minValue, scale);
  const maxPos = positionOf(maxValue, scale);

  return (
    <div className="range">
      <div className="range-hist" aria-hidden="true">
        {scale.counts.map((count, i) => {
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
            />
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
        <div
          className="range-fill"
          style={{ left: `${minPos * 100}%`, right: `${(1 - maxPos) * 100}%` }}
        />
        <div
          className="range-handle"
          data-handle="min"
          style={{ left: `${minPos * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Minimum height"
          aria-valuemin={scale.lo}
          aria-valuemax={maxValue}
          aria-valuenow={minValue}
          aria-valuetext={units.height(minValue)}
          onKeyDown={onHandleKey('min')}
        />
        <div
          className="range-handle"
          data-handle="max"
          style={{ left: `${maxPos * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Maximum height"
          aria-valuemin={minValue}
          aria-valuemax={scale.hi}
          aria-valuenow={maxValue}
          aria-valuetext={maxIndex === lastIndex ? `${units.height(maxValue)} or more` : units.height(maxValue)}
          onKeyDown={onHandleKey('max')}
        />
      </div>

      <div className="range-scale small muted" aria-hidden="true">
        <span>{units.height(scale.lo)}</span>
        <span>{units.height(scale.hi)}</span>
      </div>

      <div className="range-readouts">
        <div className="range-readout">
          <span className="range-readout-label">Minimum</span>
          <span className="range-readout-value">{units.height(minValue)}</span>
        </div>
        <div className="range-readout">
          <span className="range-readout-label">Maximum</span>
          <span className="range-readout-value">
            {maxIndex === lastIndex ? `${units.height(maxValue)}+` : units.height(maxValue)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Small parts ─────────────────────────────────────────────────────── */

function Segment({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className={`seg-btn${selected ? ' on' : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        const choices = Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
        const index = choices.indexOf(e.currentTarget);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1
          : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (index + 1) % choices.length
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (index + choices.length - 1) % choices.length : -1;
        if (next < 0) return;
        e.preventDefault();
        choices[next].focus();
        choices[next].click();
      }}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`chip${active ? ' on' : ''}`} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

/** Kept local rather than in icons.tsx: nothing else in the app uses it. */
function SlidersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 4h4M9 4h6M1 12h6M11 12h4" />
      <circle cx="7" cy="4" r="2" />
      <circle cx="9" cy="12" r="2" />
    </svg>
  );
}

/**
 * Memoised for the same reason the results list is: the map above re-renders
 * this on every pan and selection, and none of that touches the chips.
 */
export const FilterBar = memo(FilterBarInner);
