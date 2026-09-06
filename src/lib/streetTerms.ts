/**
 * Singapore street-name abbreviations.
 *
 * The ingest expands these before geocoding, so a venue is stored as
 * "Ang Mo Kio Avenue 10". People type "ang mo kio ave 10". Expanding the query
 * the same way is what makes the search find anything at all — without it,
 * every common street type ("ave", "rd", "st", "jln") silently returns nothing.
 *
 * Mirrors STREET_ABBREVIATIONS in scripts/ingest_hdb.py; keep the two in step.
 */
const EXPANSIONS: [RegExp, string][] = [
  // Contractions first — they contain sequences the shorter rules would match.
  [/\bs'goon\b/g, 'serangoon'],
  [/\bc'wealth\b/g, 'commonwealth'],
  [/\bt'pangs\b/g, 'tampines'],
  [/\bamk\b/g, 'ang mo kio'],
  [/\btpy\b/g, 'toa payoh'],
  // Cardinals and prefixes
  [/\bsth\b/g, 'south'],
  [/\bnth\b/g, 'north'],
  [/\bupp\b/g, 'upper'],
  [/\blow\b/g, 'lower'],
  [/\bctrl\b/g, 'central'],
  // Street types
  [/\bave\b/g, 'avenue'],
  [/\brd\b/g, 'road'],
  [/\bdr\b/g, 'drive'],
  [/\bcres\b/g, 'crescent'],
  [/\bln\b/g, 'lane'],
  [/\bcl\b/g, 'close'],
  [/\bpl\b/g, 'place'],
  [/\bgdns\b/g, 'gardens'],
  [/\bhts\b/g, 'heights'],
  [/\bpk\b/g, 'park'],
  [/\bter\b/g, 'terrace'],
  [/\bwk\b/g, 'walk'],
  [/\bst\b/g, 'street'],
  // Malay and other common terms
  [/\bjln\b/g, 'jalan'],
  [/\bkg\b/g, 'kampong'],
  [/\btg\b/g, 'tanjong'],
  [/\bbt\b/g, 'bukit'],
  [/\bctr\b/g, 'centre'],
  [/\btwn\b/g, 'town'],
];

/** Lowercase, collapse whitespace, and expand street abbreviations. */
export function normaliseQuery(input: string): string {
  let q = input.toLowerCase().trim().replace(/\s+/g, ' ');
  for (const [pattern, replacement] of EXPANSIONS) {
    q = q.replace(pattern, replacement);
  }
  return q;
}
