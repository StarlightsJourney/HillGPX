import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';
import type { Venue } from '../types';
import { formatHeight, type Units } from '../lib/units';
import { rankingHeight, venueHeight } from '../lib/venues';
import { glyphSvg } from '../lib/venueGlyphs';

export interface MarkerState {
  selected: string | null;
  hovered: string | null;
  visited: ReadonlySet<string>;
  units: Units;
}

interface MarkerEntry {
  venue: Venue;
  marker: Marker;
  anchor: HTMLDivElement;
  element: HTMLButtonElement;
  label: HTMLSpanElement;
}

interface MarkerHandlers {
  onSelect: (slug: string, lngLat: [number, number]) => void;
  onHover: (slug: string | null) => void;
}

interface CollisionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function intersects(a: CollisionRect, b: CollisionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

const MAX_MINI = 6;

export class VenueMarkers {
  private readonly map: MlMap;
  private readonly handlers: MarkerHandlers;
  private readonly entries = new Map<string, MarkerEntry>();
  private state: MarkerState = {
    selected: null,
    hovered: null,
    visited: new Set(),
    units: 'metric',
  };

  constructor(map: MlMap, handlers: MarkerHandlers) {
    this.map = map;
    this.handlers = handlers;
  }

  setVenues(venues: Venue[]): void {
    const wanted = new Set(venues.map((venue) => venue.slug));
    for (const [slug, entry] of this.entries) {
      if (wanted.has(slug)) continue;
      entry.marker.remove();
      this.entries.delete(slug);
    }

    for (const venue of venues) {
      const existing = this.entries.get(venue.slug);
      if (existing) {
        existing.venue = venue;
        continue;
      }

      const anchor = document.createElement('div');
      anchor.className = 'pin-anchor';
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'pin';
      element.dataset.slug = venue.slug;

      const glyph = document.createElement('span');
      glyph.className = 'pin-glyph';
      glyph.innerHTML = glyphSvg(venue.type);
      const label = document.createElement('span');
      label.className = 'pin-label';
      element.append(glyph, label);

      element.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.onSelect(venue.slug, [venue.lng, venue.lat]);
      });
      element.addEventListener('mouseenter', () => this.handlers.onHover(venue.slug));
      element.addEventListener('mouseleave', () => this.handlers.onHover(null));
      anchor.appendChild(element);

      const marker = new maplibregl.Marker({ element: anchor, anchor: 'center' })
        .setLngLat([venue.lng, venue.lat])
        .addTo(this.map);
      this.entries.set(venue.slug, { venue, marker, anchor, element, label });
    }

    this.applyState();
  }

  setState(state: MarkerState): void {
    this.state = state;
    this.applyState();
  }

  currentSlugs(): string[] {
    return [...this.entries.keys()];
  }

  layout(): void {
    const entries = [...this.entries.values()].sort((a, b) => {
      const priority = (entry: MarkerEntry) =>
        entry.venue.slug === this.state.selected ? 2 : entry.venue.slug === this.state.hovered ? 1 : 0;
      return priority(b) - priority(a) || rankingHeight(b.venue) - rankingHeight(a.venue);
    });
    const fullRects: CollisionRect[] = [];
    const miniRects: CollisionRect[] = [];
    let miniCount = 0;

    for (const entry of entries) {
      const point = this.map.project([entry.venue.lng, entry.venue.lat]);
      const width = 42 + entry.label.textContent!.length * 8.6;
      const fullRect = {
        left: point.x - width / 2 - 4,
        right: point.x + width / 2 + 4,
        top: point.y - 20,
        bottom: point.y + 20,
      };
      const protectedMarker =
        entry.venue.slug === this.state.selected || entry.venue.slug === this.state.hovered;
      const collides = !protectedMarker && fullRects.some((placed) => intersects(fullRect, placed));
      const miniRect = {
        left: point.x - 15,
        right: point.x + 15,
        top: point.y - 10,
        bottom: point.y + 10,
      };
      const isMini =
        collides && miniCount < MAX_MINI && !miniRects.some((placed) => intersects(miniRect, placed));
      const isHidden = collides && !isMini;

      entry.element.classList.toggle('is-mini', isMini);
      entry.anchor.classList.toggle('is-hidden', isHidden);
      if (!collides) fullRects.push(fullRect);
      if (isMini) {
        miniRects.push(miniRect);
        miniCount += 1;
      }
      entry.anchor.style.zIndex = String(
        entry.venue.slug === this.state.selected
          ? 4
          : entry.venue.slug === this.state.hovered
            ? 3
            : isMini
              ? 1
              : 2,
      );
    }
  }

  remove(): void {
    for (const entry of this.entries.values()) entry.marker.remove();
    this.entries.clear();
  }

  private applyState(): void {
    for (const entry of this.entries.values()) {
      const height = venueHeight(entry.venue);
      const text = height ? formatHeight(height.value, this.state.units) : entry.venue.name;
      entry.label.textContent = text;
      entry.element.setAttribute('aria-label', `${entry.venue.name}, ${text}`);
      entry.element.classList.toggle('is-selected', entry.venue.slug === this.state.selected);
      entry.element.classList.toggle('is-hover', entry.venue.slug === this.state.hovered);
      entry.element.classList.toggle('is-visited', this.state.visited.has(entry.venue.slug));
    }
  }
}
