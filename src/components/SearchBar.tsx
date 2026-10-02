import { useEffect, useMemo, useRef, useState } from 'react';
import type { Venue } from '../types';
import {
  HEIGHT_LABEL,
  boundsOf,
  buildAreas,
  matchAreas,
  rankingHeight,
  venueHeight,
  venueKindLabel,
  type Area,
  type Bounds,
} from '../lib/venues';
import { normaliseQuery } from '../lib/streetTerms';
import { useUnits } from './UnitsContext';
import { SearchIcon } from './icons';

interface SearchBarProps {
  venues: Venue[];
  onPick: (slug: string) => void;
  /**
   * Send the camera to a box rather than to a point — a whole town, or you and
   * the climbs around you.
   */
  onFitBounds: (bounds: Bounds) => void;
}

const MAX_RESULTS = 8;
const MAX_AREAS = 3;

/**
 * Search.
 *
 * Matching runs over the whole venue list on every keystroke. At ~10.8k venues a
 * lowercase substring scan is about a millisecond, so there is no index and no
 * debounce. If the dataset ever grows past a country, revisit that.
 */
export function SearchBar({ venues, onPick, onFitBounds }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const units = useUnits();

  // Lowercase names once, not once per keystroke.
  const haystack = useMemo(
    () => venues.map((v) => `${v.name} ${v.town ?? ''}`.toLowerCase()),
    [venues],
  );
  const areas = useMemo(() => buildAreas(venues), [venues]);
  const normalised = useMemo(() => normaliseQuery(query), [query]);

  // Every match, not just the ones that fit on screen. Truncating during the
  // scan would return the first eight blocks in file order and sort only those,
  // so searching a long street would hide its tallest blocks — which is the one
  // thing this app exists to surface. A full scan of ~10.8k entries costs a few
  // milliseconds, and the whole list is what a bounds fit has to be built from.
  const matches = useMemo(() => {
    // "ang mo kio ave 10" has to find "Ang Mo Kio Avenue 10", which is how the
    // ingest stores it.
    if (normalised.length < 2) return [];
    const found: Venue[] = [];
    for (let i = 0; i < haystack.length; i++) {
      if (haystack[i].includes(normalised)) found.push(venues[i]);
    }
    return found.sort((a, b) => rankingHeight(b) - rankingHeight(a));
  }, [normalised, haystack, venues]);

  const results = useMemo(() => matches.slice(0, MAX_RESULTS), [matches]);
  const areaHits = useMemo(
    () => matchAreas(areas, normalised, MAX_AREAS),
    [areas, normalised],
  );

  // Close the dropdown when clicking anywhere else.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const reset = () => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const pick = (slug: string) => {
    onPick(slug);
    reset();
  };

  const pickArea = (area: Area) => {
    onFitBounds(area.bounds);
    reset();
  };

  /**
   * Enter, from a search box, means "take me there" — that is the habit every
   * map application has trained. An area wins over a venue because a typed town
   * name is a request for the town, not for whichever of its blocks happens to
   * be tallest; and a query with several matches frames all of them rather than
   * silently picking one. An empty search just puts the caret in the box.
   */
  const submit = () => {
    if (!query.trim()) {
      inputRef.current?.focus();
      return;
    }
    if (areaHits.length > 0) {
      pickArea(areaHits[0]);
      return;
    }
    if (matches.length === 1) {
      pick(matches[0].slug);
      return;
    }
    const bounds = boundsOf(matches);
    if (bounds) {
      onFitBounds(bounds);
      setOpen(false);
    }
  };

  const message =
    normalised.length >= 2 && areaHits.length === 0 && results.length === 0 ? (
      <p className="small muted results-head">No matches. Try a different place or clear filters.</p>
    ) : null;

  // The same pill as the landing page's search, so the header keeps one shape
  // and one position on every page and at every width. It used to be a circle
  // that grew on hover, which sat off-centre on narrow windows.
  return (
    <form
      ref={rootRef}
      className={`home-search map-search${open ? ' focused' : ''}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="home-search-field home-search-where">
        <span className="home-search-label">Where</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Hills, blocks or streets"
          aria-label="Search hills, blocks, and streets"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') reset();
          }}
        />
      </label>
      <button type="submit" className="home-search-go" aria-label="Search">
        <SearchIcon size={16} />
        <span>Search</span>
      </button>
      {open && (message !== null || areaHits.length > 0 || results.length > 0) && (
        <div className="searchbar-results">
          {message}
          {areaHits.map((area) => (
            <button type="button" key={area.code} className="result-row area-row" onClick={() => pickArea(area)}>
              <span className="result-name">{area.name}</span>
              <span className="result-meta small muted">Area · {area.venueCount} places mapped</span>
            </button>
          ))}
          {results.map((venue) => {
            const height = venueHeight(venue);
            return (
              <button type="button" key={venue.slug} className="result-row" onClick={() => pick(venue.slug)}>
                <span className="result-name">{venue.name}</span>
                <span className="result-meta small muted">
                  {venueKindLabel(venue)}
                  {height && ` · ${units.height(height.value)} ${HEIGHT_LABEL[height.kind]}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </form>
  );
}
