import { memo, useMemo, useState } from 'react';
import type { Venue } from '../types';
import { VENUE_TYPE_LABEL, rankingHeight, venueHeight, venuesInBounds } from '../lib/venues';
import { VenueThumb } from './VenueThumb';
import { CloseIcon, HeartIcon } from './icons';
import { useUnits } from './UnitsContext';

interface ResultsListProps {
  venues: Venue[];
  bounds: { west: number; south: number; east: number; north: number } | null;
  onPick: (slug: string) => void;
  onClose: () => void;
  hoveredSlug?: string | null;
  onHover?: (slug: string | null) => void;
  favorites: Set<string>;
  onToggleFavorite: (slug: string) => void;
}

const PAGE = 40;

/**
 * The biggest climbs in whatever the map is currently showing.
 *
 * Tied to the viewport rather than a fixed list, which is what makes it useful:
 * pan somewhere and it answers "what is worth climbing *here*". That is also the
 * honest version of a recommendations feature — nobody has liked or saved
 * anything yet, so ranking by the one fact we actually measured beats inventing
 * popularity.
 */
function ResultsListInner({
  venues,
  bounds,
  onPick,
  onClose,
  hoveredSlug,
  onHover,
  favorites,
  onToggleFavorite,
}: ResultsListProps) {
  const units = useUnits();
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const inView = bounds ? venuesInBounds(venues, bounds) : venues;
    return [...inView]
      .sort((a, b) => rankingHeight(b) - rankingHeight(a))
      .slice(0, limit);
  }, [venues, bounds, limit]);

  const hasMore = (bounds ? venuesInBounds(venues, bounds) : venues).length > limit;

  return (
    <section className="results">
      <header className="results-head">
        <div>
          <h2>Biggest climbs here</h2>
          <p className="small muted">
            {rows.length === 0
              ? 'Nothing mapped in this area yet'
              : `Top ${rows.length} in view, tallest first`}
          </p>
        </div>
        <button type="button" className="icon-btn results-close" onClick={onClose} aria-label="Close list">
          <CloseIcon size={14} />
        </button>
      </header>

      <ul className="results-grid">
        {rows.map((venue) => {
          const height = venueHeight(venue);
          const isFavorite = favorites.has(venue.slug);
          const isHovered = hoveredSlug === venue.slug;
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
                className={`result-card${isHovered ? ' hovered' : ''}`}
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

      {hasMore && (
        <div className="results-more">
          <button type="button" className="filter-apply" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Memoised: this renders forty cards with images, and the map above it changes
 * state far more often than the list's own inputs do.
 */
export const ResultsList = memo(ResultsListInner);
