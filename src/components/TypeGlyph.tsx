import type { VenueType } from '../types';
import { VENUE_GLYPH_PATH } from '../lib/venueGlyphs';

interface TypeGlyphProps {
  type: VenueType;
  size?: number;
}

export function TypeGlyph({ type, size = 16 }: TypeGlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={VENUE_GLYPH_PATH[type]} />
    </svg>
  );
}
