import { memo, useMemo, useState } from 'react';
import type { Venue } from '../types';
import { VENUE_TYPE_LABEL, formatCount, rankingHeight, venueHeight, venuesInBounds } from '../lib/venues';
import { VenueThumb } from './VenueThumb';
import { HeartIcon, MapIcon } from './icons';
import { useUnits } from './UnitsContext';

interface ResultsListProps {
  venues: Venue[];
  bounds: { west: number; south: number; east: number; north: number } | null;
  onPick: (slug: string) => void;
  onClose: () => void;
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
  onPick,
  onClose,
  onHover,
  favorites,
  onToggleFavorite,
}: ResultsListProps) {
  const units = useUnits();
  const [page, setPage] = useState(0);

  const inView = useMemo(() => {
    const list = bounds ? venuesInBounds(venues, bounds) : venues;
    return [...list].sort((a, b) => {
      const aScore = rankingHeight(a) + (a.photo?.file ? 10_000 : 0);
      const bScore = rankingHeight(b) + (b.photo?.file ? 10_000 : 0);
      return bScore - aScore;
    });
  }, [venues, bounds]);

  const total = inView.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const rows = inView.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <section className="results">
      <div className="results-handle" aria-hidden="true" />
      <header className="results-head">
        <h2>{formatCount(total)} places</h2>
      </header>

      <ul className="results-grid">
        {rows.map((venue) => {
          const height = venueHeight(venue);
          const isFavorite = favorites.has(venue.slug);
          const badge = venue.notable
            ? { label: 'Tall', type: 'tall' as const }
            : venue.photo?.file
              ? { label: 'New', type: 'new' as const }
              : null;

          return (
            <li
              key={venue.slug}
              onMouseEnter={() => onHover?.(venue.slug)}
              onMouseLeave={() => onHover?.(null)}
            >
              <button
                type="button"
                className="result-card"
                onClick={() => onPick(venue.slug)}
              >
                {badge && <span className={`result-badge ${badge.type}`}>{badge.label}</span>}
                <button
                  type="button"
                  className={`result-favorite${isFavorite ? ' on' : ''}`}
                  aria-label={isFavorite ? 'Remove favourite' : 'Add to favourites'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(venue.slug);
                  }}
                >
                  <HeartIcon size={18} filled={isFavorite} />
                </button>
                <VenueThumb venue={venue} />
                <span className="result-card-name">{venue.name}</span>
                <span className="result-card-meta">
                  {VENUE_TYPE_LABEL[venue.type]}
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
                  {venue.routeSlugs.length > 0 &&
                    ` · ${venue.routeSlugs.length} route${venue.routeSlugs.length > 1 ? 's' : ''}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Pagination current={currentPage + 1} total={totalPages} onPage={(n) => setPage(n - 1)} />

      <button type="button" className="show-map-btn" onClick={onClose}>
        <MapIcon size={16} />
        Show map
      </button>
    </section>
  );
}

/**
 * Memoised: this renders a page of cards with images, and the map above it changes
 * state far more often than the list's own inputs do.
 */
export const ResultsList = memo(ResultsListInner);
