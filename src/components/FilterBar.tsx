import {
  memo,
  useCallback,
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
import type { Route, Venue, VenueType } from '../types';
import {
  NO_FILTERS,
  VENUE_TYPE_LABEL,
  activeFilterCount,
  filterVenues,
  rankingHeight,
  type VenueFilters,
} from '../lib/venues';
import { NO_ROUTE_FILTERS, ROUTE_CATEGORIES, filterRoutes, type RouteCategory, type RouteFilters } from '../lib/routes';
import { VENUE_GLYPH_PATH } from '../lib/venueGlyphs';

export type BrowseMode = 'climbs' | 'routes';

interface FilterBarProps {
  /** The types present in the data, so no chip is offered that returns nothing. */
  types: VenueType[];
  /**
   * Venues inside the current map viewport before filtering. The histogram and
   * draft count stay anchored to the area on screen while controls change.
   */
  visibleVenues: Venue[];
  filters: VenueFilters;
  onChange: (filters: VenueFilters) => void;
}

interface CategoryBarProps extends FilterBarProps {
  mode: BrowseMode;
  onModeChange: (mode: BrowseMode) => void;
  routes: Route[];
  routeFilters: RouteFilters;
  onRouteFiltersChange: (filters: RouteFilters) => void;
}

type ClimbCategory = 'all' | VenueType | 'top' | 'photo';

function climbCategoryOf(filters: VenueFilters): ClimbCategory | null {
  const { types, notableOnly, withPhoto } = filters;
  if (types.length === 0 && !notableOnly && !withPhoto) return 'all';
  if (types.length === 1 && !notableOnly && !withPhoto) return types[0];
  if (types.length === 0 && notableOnly && !withPhoto) return 'top';
  if (types.length === 0 && !notableOnly && withPhoto) return 'photo';
  return null;
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function CategoryIcon({ id }: { id: string }) {
  if (id in VENUE_GLYPH_PATH) {
    return (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d={VENUE_GLYPH_PATH[id as VenueType]} />
      </svg>
    );
  }
  const paths: Record<string, ReactNode> = {
    all: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    top: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7L12 3z" />,
    photo: <><path d="M3 8h3.5L8 6h8l1.5 2H21v11H3V8z" /><circle cx="12" cy="13" r="3.5" /></>,
    climb: <path d="M2 20l6-9 4 5 3-4 7 8H2zM15 4l2 3 2-3" />,
    loop: <><path d="M17 7a7 7 0 1 0 2 5" /><path d="M20 3v5h-5" /></>,
    short: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 16l8-8" /></>,
    long: <><circle cx="4" cy="19" r="2" /><circle cx="20" cy="5" r="2" /><path d="M6 18c6-1 3-7 8-9s4-3 4-3" /></>,
    saved: <><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10 18h4" /></>,
  };
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      {paths[id] ?? paths.all}
    </svg>
  );
}

/**
 * The strip under the header: which kind of thing you are browsing, then a
 * row of icon categories, then Filters — Airbnb's category bar, pointed at
 * climbs and routes instead of homes.
 */
function CategoryBarInner({
  mode,
  onModeChange,
  routes,
  routeFilters,
  onRouteFiltersChange,
  ...climbProps
}: CategoryBarProps) {
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const routeOpenerRef = useRef<HTMLButtonElement>(null);
  const routeFilterCount = (routeFilters.minGainM != null ? 1 : 0) + (routeFilters.maxDistanceM != null ? 1 : 0);

  return (
    <div className="filterbar">
      <div className="filterbar-row">
        <div className="mode-switch" role="tablist" aria-label="Browse">
          {(['climbs', 'routes'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={`mode-tab${mode === value ? ' on' : ''}`}
              onClick={() => onModeChange(value)}
            >
              {value === 'climbs' ? 'Climbs' : 'Routes'}
            </button>
          ))}
          <span className={`mode-thumb ${mode}`} aria-hidden="true" />
        </div>

        <span className="filterbar-divider" aria-hidden="true" />

        {mode === 'climbs' ? (
          <ClimbCategories {...climbProps} />
        ) : (
          <>
            <div className="categories" role="tablist" aria-label="Route type">
              {ROUTE_CATEGORIES.map((category) => {
                const count = filterRoutes(routes, { ...NO_ROUTE_FILTERS, category: category.id }).length;
                if (category.id === 'saved' && count === 0) return null;
                return (
                  <CategoryButton
                    key={category.id}
                    id={category.id}
                    label={category.label}
                    active={routeFilters.category === category.id}
                    disabled={count === 0}
                    onClick={() => onRouteFiltersChange({ ...routeFilters, category: category.id as RouteCategory })}
                  />
                );
              })}
            </div>
            <button
              type="button"
              ref={routeOpenerRef}
              className={`filter-open${routeFilterCount > 0 ? ' on' : ''}`}
              aria-haspopup="dialog"
              onClick={() => setRouteModalOpen(true)}
            >
              <SlidersIcon />
              Filters
              {routeFilterCount > 0 && <span className="filter-badge">{routeFilterCount}</span>}
            </button>
            {routeModalOpen && (
              <RouteFilterModal
                routes={routes}
                filters={routeFilters}
                onChange={onRouteFiltersChange}
                onClose={() => setRouteModalOpen(false)}
                returnFocusTo={routeOpenerRef}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CategoryButton({
  id,
  label,
  active,
  disabled = false,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`category${active ? ' on' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <CategoryIcon id={id} />
      <span>{label}</span>
    </button>
  );
}

const GAIN_CHOICES: { label: string; value: number | null }[] = [
  { label: 'Any', value: null },
  { label: '200 m+', value: 200 },
  { label: '500 m+', value: 500 },
  { label: '1,000 m+', value: 1000 },
];
const DISTANCE_CHOICES: { label: string; value: number | null }[] = [
  { label: 'Any', value: null },
  { label: 'Up to 10 km', value: 10_000 },
  { label: 'Up to 25 km', value: 25_000 },
  { label: 'Up to 50 km', value: 50_000 },
];

function RouteFilterModal({
  routes,
  filters,
  onChange,
  onClose,
  returnFocusTo,
}: {
  routes: Route[];
  filters: RouteFilters;
  onChange: (filters: RouteFilters) => void;
  onClose: () => void;
  returnFocusTo: React.RefObject<HTMLElement>;
}) {
  const [draft, setDraft] = useState(filters);
  const [closing, setClosing] = useState(false);
  const count = filterRoutes(routes, draft).length;
  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    const opener = returnFocusTo.current;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [close, returnFocusTo]);

  return createPortal(
    <div
      className={`filter-scrim${closing ? ' closing' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className={`filter-modal filter-modal-sm${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-filter-title"
        onAnimationEnd={(e) => e.target === e.currentTarget && closing && onClose()}
      >
        <header className="filter-modal-head">
          <h2 id="route-filter-title">Route filters</h2>
          <button type="button" className="filter-modal-close" aria-label="Close filters" onClick={close}>
            <CloseIcon />
          </button>
        </header>
        <div className="filter-modal-body">
          <section className="filter-group">
            <h3>Minimum EG</h3>
            <div className="seg" role="radiogroup" aria-label="Minimum EG">
              {GAIN_CHOICES.map((choice) => (
                <Segment key={choice.label} selected={draft.minGainM === choice.value} onSelect={() => setDraft({ ...draft, minGainM: choice.value })}>
                  {choice.label}
                </Segment>
              ))}
            </div>
          </section>
          <section className="filter-group">
            <h3>Distance</h3>
            <div className="seg" role="radiogroup" aria-label="Maximum distance">
              {DISTANCE_CHOICES.map((choice) => (
                <Segment key={choice.label} selected={draft.maxDistanceM === choice.value} onSelect={() => setDraft({ ...draft, maxDistanceM: choice.value })}>
                  {choice.label}
                </Segment>
              ))}
            </div>
          </section>
        </div>
        <footer className="filter-modal-foot">
          <button type="button" className="linkish" onClick={() => setDraft({ ...NO_ROUTE_FILTERS, category: draft.category })}>
            Clear all
          </button>
          <button
            type="button"
            className="filter-apply"
            disabled={count === 0}
            onClick={() => {
              onChange(draft);
              close();
            }}
          >
            {count === 0 ? 'No matches' : `Show ${count} route${count === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
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
function ClimbCategories({ types, visibleVenues, filters, onChange }: FilterBarProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  const count = activeFilterCount(filters);
  const active = climbCategoryOf(filters);
  const pick = (category: ClimbCategory) =>
    onChange({
      ...filters,
      types: category === 'all' || category === 'top' || category === 'photo' ? [] : [category],
      notableOnly: category === 'top',
      withPhoto: category === 'photo',
    });

  const categories: { id: ClimbCategory; label: string }[] = [
    { id: 'all', label: 'All' },
    ...types.map((type) => ({ id: type as ClimbCategory, label: type === 'hill' ? 'Hills & summits' : `${VENUE_TYPE_LABEL[type]}s` })),
    { id: 'top', label: 'Top EG' },
    { id: 'photo', label: 'With photos' },
  ];

  return (
    <>
      <div className="categories" role="tablist" aria-label="Climb type">
        {categories.map((category) => (
          <CategoryButton
            key={category.id}
            id={category.id}
            label={category.label}
            active={active === category.id}
            onClick={() => pick(category.id)}
          />
        ))}
      </div>
      <button
        type="button"
        ref={openerRef}
        className={`filter-open${count > 0 && active === null ? ' on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
        onClick={() => setModalOpen(true)}
      >
        <SlidersIcon />
        Filters
        {count > 0 && <span className="filter-badge">{count}</span>}
      </button>

      {modalOpen && (
        <FilterModal
          types={types}
          visibleVenues={visibleVenues}
          filters={filters}
          onChange={onChange}
          onClose={() => setModalOpen(false)}
          returnFocusTo={openerRef}
        />
      )}
    </>
  );
}

/* ─── The dialog ──────────────────────────────────────────────────────── */

interface FilterModalProps extends FilterBarProps {
  onClose: () => void;
  returnFocusTo: React.RefObject<HTMLElement>;
}

/**
 * Dialog changes are drafted, and the footer count catches up after a short
 * pause so its number does not flicker while a height handle is being dragged.
 * Pressing Show commits the draft — Airbnb's pattern. The chips outside the
 * dialog remain immediate.
 */
function FilterModal({
  types,
  visibleVenues,
  filters,
  onChange,
  onClose,
  returnFocusTo,
}: FilterModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<VenueFilters>(filters);
  const [draftCount, setDraftCount] = useState(() => filterVenues(visibleVenues, filters).length);
  const [counting, setCounting] = useState(true);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose();
    else setClosing(true);
  }, [closing, onClose]);

  useEffect(() => {
    setCounting(true);
    const timer = window.setTimeout(() => {
      setDraftCount(filterVenues(visibleVenues, draft).length);
      setCounting(false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, visibleVenues]);

  // Escape and the focus trap are on the document rather than the dialog so
  // they still fire while a handle inside is being dragged with the pointer
  // captured, which is exactly when a stuck dialog would be most annoying.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
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
  }, [requestClose]);

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

  const selectedType: VenueType | null = draft.types.length === 1 ? draft.types[0] : null;

  // Portalled to the body: .filterbar sits in a stacking context below the
  // topbar, so a scrim rendered in place would be painted under the search bar
  // it is supposed to cover.
  return createPortal(
    <div
      className={`filter-scrim${closing ? ' closing' : ''}`}
      // mousedown, not click: a drag that starts on a handle and ends outside
      // the dialog fires a click on the scrim, which would shut the dialog the
      // instant you overshot the end of the slider.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className={`filter-modal${entered ? ' entered' : ''}${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-modal-title"
        ref={dialogRef}
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.animationName === 'modal-in') setEntered(true);
          if (closing && event.animationName === 'modal-out') onClose();
        }}
      >
        <header className="filter-modal-head">
          <h2 id="filter-modal-title">Filters</h2>
          <button
            type="button"
            ref={closeRef}
            className="filter-modal-close"
            aria-label="Close filters"
            onClick={requestClose}
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
                onSelect={() => setDraft({ ...draft, types: [] })}
              >
                Any type
              </Segment>
              {types.map((type) => (
                <Segment
                  key={type}
                  selected={selectedType === type}
                  onSelect={() => setDraft({ ...draft, types: [type] })}
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
              minHeightM={draft.minHeightM}
              maxHeightM={draft.maxHeightM}
              onChange={(minHeightM, maxHeightM) => setDraft({ ...draft, minHeightM, maxHeightM })}
            />
          </section>
        </div>

        <footer className="filter-modal-foot">
          <button type="button" className="linkish" onClick={() => setDraft(NO_FILTERS)}>
            Clear all
          </button>
          <button
            type="button"
            className="filter-apply"
            disabled={counting}
            aria-busy={counting}
            onClick={() => {
              onChange(draft);
              requestClose();
            }}
          >
            {counting ? (
              <>
                <span className="dots" aria-hidden="true">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
                <span className="visually-hidden" aria-live="polite">Counting…</span>
              </>
            ) : draftCount === 0 ? (
              'No matches'
            ) : draftCount >= 1000 ? (
              'Show over 1,000 venues'
            ) : (
              `Show ${draftCount.toLocaleString()} venue${draftCount === 1 ? '' : 's'}`
            )}
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
export const FilterBar = memo(CategoryBarInner);
