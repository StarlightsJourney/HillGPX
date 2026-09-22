import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Venue } from '../types';
import { VENUE_TYPE_LABEL, rankingHeight, venueHeight, venuesInBounds } from '../lib/venues';
import { VenueThumb } from './VenueThumb';
import { HeartIcon, SearchIcon, StarIcon } from './icons';
import { useUnits } from './UnitsContext';
import { regionOf } from '../lib/regions';

export function RatingLabel({ rating }: { rating?: { average: number; count: number } }) {
  if (!rating || rating.count === 0) return null;
  return (
    <span className="rating" aria-label={`Rated ${rating.average.toFixed(1)} out of 5 by ${rating.count}`}>
      <StarIcon size={12} filled />
      {rating.average.toFixed(2).replace(/0$/, '')}
      <span className="rating-count">({rating.count})</span>
    </span>
  );
}

interface ResultsListProps {
  venues: Venue[];
  bounds: { west: number; south: number; east: number; north: number } | null;
  routeCounts: Map<string, number>;
  onHover?: (slug: string | null) => void;
  favorites: Set<string>;
  onToggleFavorite: (slug: string) => void;
}

const PAGE_SIZE = 24;

type PageItem = number | 'ellipsis';

function pageRange(total: number, current: number): PageItem[] {
  const pages: PageItem[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
    return pages;
  }
  if (current <= 4) {
    pages.push(1, 2, 3, 4, 'ellipsis', total);
  } else if (current >= total - 3) {
    pages.push(1, 'ellipsis', total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total);
  }
  return pages;
}

function Pagination({
  current,
  total,
  onPage,
}: {
  current: number;
  total: number;
  onPage: (n: number) => void;
}) {
  if (total <= 1) return null;
  const items = pageRange(total, current);
  return (
    <nav className="pagination" aria-label="Result pages">
      <button
        type="button"
        className="page-btn"
        onClick={() => onPage(current - 1)}
        disabled={current === 1}
        aria-label="Previous page"
      >
        {'‹'}
      </button>
      {items.map((item, i) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${i}`} className="page-ellipsis" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={`page-btn${item === current ? ' active' : ''}`}
            onClick={() => onPage(item)}
            aria-label={`Page ${item}`}
            aria-current={item === current ? 'page' : undefined}
          >
            {item}
          </button>
        )
      )}
      <button
        type="button"
        className="page-btn"
        onClick={() => onPage(current + 1)}
        disabled={current === total}
        aria-label="Next page"
      >
        {'›'}
      </button>
    </nav>
  );
}

/**
 * The biggest climbs in whatever the map is currently showing.
 *
 * Tied to the viewport rather than a fixed list, which is what makes it useful:
 * pan somewhere and it answers "what is worth climbing *here*". That is also the
 * honest version of a recommendations feature — nobody has liked or saved
 * anything yet, so ranking by the one fact we actually measured beats inventing
 * popularity. Venues that have a photo are surfaced first, because a missing
 * photo is the easiest clue that an entry still needs attention.
 */
function ResultsListInner({
  venues,
  bounds,
  routeCounts,
  onHover,
  favorites,
  onToggleFavorite,
}: ResultsListProps) {
  const units = useUnits();
  const sectionRef = useRef<HTMLElement>(null);
  const [page, setPage] = useState(0);
  const [shownKey, setShownKey] = useState('');

  useEffect(() => setPage(0), [venues, bounds]);

  const inView = useMemo(() => {
    const list = bounds ? venuesInBounds(venues, bounds) : venues;
    return [...list].sort((a, b) => {
      const aScore = rankingHeight(a) + (a.photo?.file ? 10_000 : 0);
      const bScore = rankingHeight(b) + (b.photo?.file ? 10_000 : 0);
      return bScore - aScore;
    });
  }, [venues, bounds]);

  const total = inView.length;
  const heading =
    total >= 1000
      ? 'Over 1,000 places'
      : `${total.toLocaleString()} place${total === 1 ? '' : 's'}`;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const rows = inView.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const pageKey = rows.map((row) => row.slug).join('|');
  const loading = pageKey !== shownKey;

  useEffect(() => {
    if (!pageKey) {
      setShownKey('');
      return;
    }

    let cancelled = false;
    let earliestPassed = false;
    let settled = false;
    const reveal = () => {
      if (!cancelled && earliestPassed && settled) setShownKey(pageKey);
    };
    const earliest = window.setTimeout(() => {
      earliestPassed = true;
      reveal();
    }, 250);
    const latest = window.setTimeout(() => {
      settled = true;
      reveal();
    }, 700);

    Promise.all(
      rows.map(
        (venue) =>
          new Promise<void>((resolve) => {
            if (!venue.photo?.file) {
              resolve();
              return;
            }
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => resolve();
            image.src = `${import.meta.env.BASE_URL}${venue.photo.file}`;
          }),
      ),
    ).then(() => {
      settled = true;
      window.clearTimeout(latest);
      reveal();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(earliest);
      window.clearTimeout(latest);
    };
  }, [pageKey]);

  return (
    <section className="results" ref={sectionRef}>
      <header className="results-head">
        <h2>{heading}</h2>
      </header>

      {total === 0 && !loading ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <SearchIcon size={28} />
          </div>
          <h3>No venues match</h3>
          <p>Try widening the map area, clearing filters, or searching for a town or street name.</p>
        </div>
      ) : (
        <ul className="results-grid" aria-busy={loading}>
          {loading
            ? rows.map((venue) => (
                <li key={venue.slug} className="skeleton-card" aria-hidden="true">
                  <span className="sk-thumb" />
                  <span className="sk-line" />
                  <span className="sk-line" />
                  <span className="sk-line" />
                </li>
              ))
            : rows.map((venue, index) => {
                const height = venueHeight(venue);
                const isFavorite = favorites.has(venue.slug);
                const routeCount = venue.routeSlugs.length + (routeCounts.get(venue.slug) ?? 0);
                const region = regionOf(venue.lng, venue.lat);

                return (
                  <li
                    key={venue.slug}
                    className="result-item"
                    style={{ '--i': index } as React.CSSProperties}
                    onMouseEnter={() => onHover?.(venue.slug)}
                    onMouseLeave={() => onHover?.(null)}
                  >
                    {venue.notable && <span className="result-badge">Top climb</span>}
                    <button
                      type="button"
                      className={`result-favorite${isFavorite ? ' on' : ''}`}
                      aria-label={isFavorite ? 'Remove favourite' : 'Add to favourites'}
                      onClick={() => onToggleFavorite(venue.slug)}
                    >
                      <HeartIcon size={24} filled={isFavorite} />
                    </button>
                    <a className="result-card" data-slug={venue.slug} href={`#venue/${venue.slug}`}>
                      <VenueThumb venue={venue} />
                      <span className="result-card-top">
                        <span className="result-card-name">{venue.name}</span>
                        <RatingLabel rating={venue.rating} />
                      </span>
                      <span className="result-card-meta">
                        {VENUE_TYPE_LABEL[venue.type]}
                        {region && region !== 'Singapore' ? ` in ${region}` : ''}
                        {venue.storeys != null && ` · ${venue.storeys} floors`}
                      </span>
                      <span className="result-card-gain">
                        {height ? (
                          <>
                            <strong>{units.height(height.value)}</strong>{' '}
                            {height.kind === 'gain' ? 'to climb' : 'above sea level'}
                          </>
                        ) : (
                          'Height not recorded'
                        )}
                        {routeCount > 0 && ` · ${routeCount} route${routeCount > 1 ? 's' : ''}`}
                      </span>
                    </a>
                  </li>
                );
              })}
        </ul>
      )}

      {total > 0 && (
        <Pagination
          current={currentPage + 1}
          total={totalPages}
          onPage={(nextPage) => {
            setPage(nextPage - 1);
            const pane = sectionRef.current?.closest('.list-pane');
            if (pane instanceof HTMLElement) pane.scrollTo({ top: 0 });
            else window.scrollTo({ top: 0 });
          }}
        />
      )}
    </section>
  );
}

/**
 * Memoised: this renders a page of cards with images, and the map above it changes
 * state far more often than the list's own inputs do.
 */
export const ResultsList = memo(ResultsListInner);
