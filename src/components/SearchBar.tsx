import { useEffect, useMemo, useRef, useState } from 'react';
import type { Venue } from '../types';
import { VENUE_TYPE_LABEL, effectiveGain, formatDistance, tallestWithin } from '../lib/venues';

interface SearchBarProps {
  venues: Venue[];
  onPick: (slug: string) => void;
}

type Mode = 'search' | 'nearby';

const MAX_RESULTS = 8;
const NEARBY_RADIUS_M = 2000;

/**
 * Search, and "what's the biggest climb near me".
 *
 * Matching runs over the whole venue list on every keystroke. At ~13k venues a
 * lowercase substring scan is about a millisecond, so there is no index and no
 * debounce — both would be machinery for a cost that is not being paid. If the
 * dataset ever grows past a country, revisit that.
 */
export function SearchBar({ venues, onPick }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('search');
  const [nearby, setNearby] = useState<{ venue: Venue; distanceM: number }[]>([]);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Lowercase names once, not once per keystroke.
  const haystack = useMemo(
    () => venues.map((v) => `${v.name} ${v.town ?? ''}`.toLowerCase()),
    [venues],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const found: Venue[] = [];
    for (let i = 0; i < haystack.length && found.length < MAX_RESULTS; i++) {
      if (haystack[i].includes(q)) found.push(venues[i]);
    }
    // Bigger climbs first among equally good name matches.
    return found.sort((a, b) => (effectiveGain(b) ?? 0) - (effectiveGain(a) ?? 0));
  }, [query, haystack, venues]);

  // Close the dropdown when clicking anywhere else.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const locate = () => {
    if (!navigator.geolocation) {
      setLocateError('This browser has no location support.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setNearby(tallestWithin(venues, longitude, latitude, NEARBY_RADIUS_M, MAX_RESULTS));
        setMode('nearby');
        setOpen(true);
        setLocating(false);
      },
      (err) => {
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : 'Could not get your location.',
        );
        setLocating(false);
        setOpen(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const pick = (slug: string) => {
    onPick(slug);
    setOpen(false);
    setQuery('');
  };

  const showing = mode === 'nearby' ? nearby.map((n) => n.venue) : results;
  const distanceFor = (slug: string) =>
    mode === 'nearby' ? nearby.find((n) => n.venue.slug === slug)?.distanceM : undefined;

  return (
    <div className="searchbar" ref={rootRef}>
      <div className="searchbar-row">
        <input
          type="search"
          value={query}
          placeholder="Search a hill, street or block…"
          aria-label="Search hills and blocks"
          onFocus={() => {
            setMode('search');
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setMode('search');
            setOpen(true);
          }}
        />
        <button
          className="locate-btn"
          onClick={locate}
          disabled={locating}
          title="Biggest climbs near me"
        >
          {locating ? '…' : 'Near me'}
        </button>
      </div>

      {open && (locateError || showing.length > 0 || (mode === 'nearby' && nearby.length === 0)) && (
        <div className="searchbar-results">
          {locateError && <p className="small error">{locateError}</p>}

          {mode === 'nearby' && !locateError && (
            <p className="small muted results-head">
              {nearby.length > 0
                ? `Biggest climbs within ${formatDistance(NEARBY_RADIUS_M)}`
                : `Nothing mapped within ${formatDistance(NEARBY_RADIUS_M)} of you.`}
            </p>
          )}

          {showing.map((venue) => {
            const gain = effectiveGain(venue);
            const distance = distanceFor(venue.slug);
            return (
              <button key={venue.slug} className="result-row" onClick={() => pick(venue.slug)}>
                <span className="result-name">{venue.name}</span>
                <span className="result-meta small muted">
                  {VENUE_TYPE_LABEL[venue.type]}
                  {gain != null && ` · ${Math.round(gain)} m up`}
                  {distance != null && ` · ${formatDistance(distance)} away`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
