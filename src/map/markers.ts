import { Marker, type Map as MlMap } from 'maplibre-gl';
import type { Route, Venue } from '../types';
import { formatDistanceIn, formatHeight, type Units } from '../lib/units';
import { rankingHeight, venueHeight } from '../lib/venues';
import { glyphSvg } from '../lib/venueGlyphs';
import { setSvgIcon } from '../lib/dom';

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
      setSvgIcon(glyph, glyphSvg(venue.type));
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

      const marker = new Marker({ element: anchor, anchor: 'center' })
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

const ROUTE_GLYPH =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="3.5" cy="12.5" r="1.8"/><circle cx="12.5" cy="3.5" r="1.8"/><path d="M5 11.5c3-1 1.5-4 4-5.2 1-.5 1.8-.9 2-1.5"/></svg>';

/**
 * One pill per route, at its start, labelled with its distance — the route
 * equivalent of a price tag on a listing map.
 */
export class RouteMarkers {
  private readonly map: MlMap;
  private readonly handlers: { onSelect: (slug: string) => void; onHover: (slug: string | null) => void };
  private readonly entries = new Map<string, { route: Route; marker: Marker; element: HTMLButtonElement; label: HTMLSpanElement }>();

  constructor(map: MlMap, handlers: { onSelect: (slug: string) => void; onHover: (slug: string | null) => void }) {
    this.map = map;
    this.handlers = handlers;
  }

  setRoutes(routes: Route[], units: Units): void {
    const wanted = new Set(routes.map((route) => route.slug));
    for (const [slug, entry] of this.entries) {
      if (wanted.has(slug)) continue;
      entry.marker.remove();
      this.entries.delete(slug);
    }
    for (const route of routes) {
      if (route.coordinates.length === 0) continue;
      let entry = this.entries.get(route.slug);
      if (!entry) {
        const anchor = document.createElement('div');
        anchor.className = 'pin-anchor';
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'pin route-pin';
        const glyph = document.createElement('span');
        glyph.className = 'pin-glyph';
        setSvgIcon(glyph, ROUTE_GLYPH);
        const label = document.createElement('span');
        label.className = 'pin-label';
        element.append(glyph, label);
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          this.handlers.onSelect(route.slug);
        });
        element.addEventListener('mouseenter', () => this.handlers.onHover(route.slug));
        element.addEventListener('mouseleave', () => this.handlers.onHover(null));
        anchor.appendChild(element);
        const [lng, lat] = route.coordinates[0];
        const marker = new Marker({ element: anchor, anchor: 'center' }).setLngLat([lng, lat]).addTo(this.map);
        entry = { route, marker, element, label };
        this.entries.set(route.slug, entry);
      }
      entry.route = route;
      entry.label.textContent = formatDistanceIn(route.distanceM, units);
      entry.element.setAttribute('aria-label', `${route.name}, ${entry.label.textContent}`);
    }
  }

  setState(selected: string | null, hovered: string | null): void {
    for (const [slug, entry] of this.entries) {
      entry.element.classList.toggle('is-selected', slug === selected);
      entry.element.classList.toggle('is-hover', slug === hovered);
      entry.marker.getElement().style.zIndex = slug === selected ? '4' : slug === hovered ? '3' : '2';
    }
  }

  remove(): void {
    for (const entry of this.entries.values()) entry.marker.remove();
    this.entries.clear();
  }
}
