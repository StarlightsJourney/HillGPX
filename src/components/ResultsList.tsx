import { memo, useMemo } from 'react';
import type { Venue } from '../types';
import { VENUE_TYPE_LABEL, rankingHeight, venueHeight, venuesInBounds } from '../lib/venues';
import { VenueThumb } from './VenueThumb';

interface ResultsListProps {
  venues: Venue[];
  bounds: { west: number; south: number; east: number; north: number } | null;
  onPick: (slug: string) => void;
  onClose: () => void;
}

const MAX_ROWS = 40;

/**
 * The biggest climbs in whatever the map is currently showing.
 *
 * Tied to the viewport rather than a fixed list, which is what makes it useful:
 * pan somewhere and it answers "what is worth climbing *here*". That is also the
 * honest version of a recommendations feature — nobody has liked or saved
 * anything yet, so ranking by the one fact we actually measured beats inventing
 * popularity.
 */
function ResultsListInner({ venues, bounds, onPick, onClose }: ResultsListProps) {
  const rows = useMemo(() => {
    const inView = bounds ? venuesInBounds(venues, bounds) : venues;
    return [...inView]
      .sort((a, b) => rankingHeight(b) - rankingHeight(a))
      .slice(0, MAX_ROWS);
  }, [venues, bounds]);

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
        <button className="icon-btn" onClick={onClose} aria-label="Close list">
          ×
        </button>
      </header>

      <ul className="results-grid">
        {rows.map((venue) => {
          const height = venueHeight(venue);
          return (
            <li key={venue.slug}>
              <button className="result-card" onClick={() => onPick(venue.slug)}>
                <VenueThumb venue={venue} />
                <span className="result-card-name">{venue.name}</span>
                <span className="result-card-meta">
                  {VENUE_TYPE_LABEL[venue.type]}
                  {venue.storeys != null && ` · ${venue.storeys} floors`}
                </span>
                <span className="result-card-gain">
                  {height ? (
                    <>
                      <strong>{Math.round(height.value)} m</strong>{' '}
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
    </section>
  );
}

/**
 * Memoised: this renders forty cards with images, and the map above it changes
 * state far more often than the list's own inputs do.
 */
export const ResultsList = memo(ResultsListInner);
