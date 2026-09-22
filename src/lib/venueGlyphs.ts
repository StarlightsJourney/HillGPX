import type { VenueType } from '../types';

export const VENUE_GLYPH_PATH: Record<VenueType, string> = {
  hill: 'M.75 13.5 5.7 4l2.05 3.7 1.7-2.55 5.8 8.35H.75Zm3.25-2h8.05L9.5 7.8 7.7 10.45 5.65 6.8 4 11.5Z',
  hdb_block: 'M3 1h10v2H3V1Zm0 2h2v12H3V3Zm8 0h2v12h-2V3ZM3 13h10v2H3v-2Zm3-9h1.5v2H6V4Zm2.5 0H10v2H8.5V4ZM6 7h1.5v2H6V7Zm2.5 0H10v2H8.5V7ZM6 10h1.5v2H6v-2Zm2.5 0H10v2H8.5v-2Z',
  stairs: 'M1 12h3V9h3V6h3V3h5v2h-3v3H9v3H6v3H1v-2Z',
  park: 'M7 14V9.8H4.9a3.2 3.2 0 0 1 .65-6.34A3.5 3.5 0 0 1 12 5.25a2.75 2.75 0 0 1-.9 5.34H9V14h3v1H4v-1h3Z',
  carpark: 'M3.1 4.5 4.4 2h7.2l1.3 2.5A2.5 2.5 0 0 1 15 7v5h-1v2h-2v-2H4v2H2v-2H1V7a2.5 2.5 0 0 1 2.1-2.5ZM4.8 4 4 5.5h8L11.2 4H4.8ZM3.5 7A1.5 1.5 0 1 0 5 8.5 1.5 1.5 0 0 0 3.5 7Zm9 0A1.5 1.5 0 1 0 14 8.5 1.5 1.5 0 0 0 12.5 7Z',
  bridge: 'M1 5h14v2h-1v7h-2v-2a4 4 0 0 0-8 0v2H2V7H1V5Zm3 2v1.25A5.9 5.9 0 0 1 8 6.7a5.9 5.9 0 0 1 4 1.55V7H4Z',
};

export function glyphSvg(type: VenueType): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${VENUE_GLYPH_PATH[type]}"/></svg>`;
}
