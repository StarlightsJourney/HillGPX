import { Marker, type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import type { Route, Venue } from '../types';
import { formatDistanceIn, formatHeight, type Units } from '../lib/units';
import { rankingHeight, venueHeight } from '../lib/venues';
import { glyphSvg } from '../lib/venueGlyphs';
import { setSvgIcon } from '../lib/dom';
import { activityGlyphSvg } from '../lib/activityGlyphs';
import { ACTIVITY_LABEL, routeActivity } from '../lib/routeAnalysis';
import { setRouteStarts } from './layers';

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


interface RouteMarkerHandlers {
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
  /** A cluster was tapped: zoom to where it splits apart. */
  onCluster: (lngLat: [number, number], zoom: number) => void;
}

interface RouteMarkerEntry {
  route: Route;
  marker: Marker;
  anchor: HTMLDivElement;
  element: HTMLButtonElement;
  label: HTMLSpanElement;
}

/**
 * One pill per route, at its start, labelled with its distance — the route
 * equivalent of a price tag on a listing map. Zoomed out, starts that crowd
 * each other merge into one "12 routes" pill (the clustered `route-starts`
 * source decides which), and tapping it zooms in until they part.
 */
export class RouteMarkers {
  private readonly map: MlMap;
  private readonly handlers: RouteMarkerHandlers;
  private readonly entries = new Map<string, RouteMarkerEntry>();
  private readonly clusters = new Map<number, { marker: Marker; element: HTMLButtonElement; label: HTMLSpanElement }>();
  /** Slugs the source shows on their own; null until its tiles have loaded once. */
  private singles: Set<string> | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  // Once the map has settled: mid-zoom, the tiles on screen can mix two zoom
  // levels, and a route would show as both a pin and part of a count.
  private readonly onIdle = () => this.sync();

  constructor(map: MlMap, handlers: RouteMarkerHandlers) {
    this.map = map;
    this.handlers = handlers;
    map.on('idle', this.onIdle);
  }

  setRoutes(routes: Route[], units: Units): void {
    setRouteStarts(this.map, routes);
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
        const activity = routeActivity(route);
        element.className = `pin route-pin ${activity}`;
        element.dataset.slug = route.slug;
        const glyph = document.createElement('span');
        glyph.className = 'pin-glyph route-pin-badge';
        setSvgIcon(glyph, activityGlyphSvg(activity, 17, 2.4));
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
        entry = { route, marker, anchor, element, label };
        this.entries.set(route.slug, entry);
      }
      entry.route = route;
      entry.label.textContent = formatDistanceIn(route.distanceM, units);
      entry.element.setAttribute('aria-label', `${route.name}, ${ACTIVITY_LABEL[routeActivity(route)]}, ${entry.label.textContent}`);
    }
    if (routes.length === 0) this.clearClusters();
    // The re-tiled source settles on the next idle; until then the last split stands.
    this.applyVisibility();
  }

  setState(selected: string | null, hovered: string | null): void {
    this.selected = selected;
    this.hovered = hovered;
    for (const [slug, entry] of this.entries) {
      entry.element.classList.toggle('is-selected', slug === selected);
      entry.element.classList.toggle('is-hover', slug === hovered);
      entry.anchor.style.zIndex = slug === selected ? '4' : slug === hovered ? '3' : '2';
    }
    this.applyVisibility();
  }

  remove(): void {
    this.map.off('idle', this.onIdle);
    for (const entry of this.entries.values()) entry.marker.remove();
    this.entries.clear();
    this.clearClusters();
  }

  private clearClusters(): void {
    for (const cluster of this.clusters.values()) cluster.marker.remove();
    this.clusters.clear();
  }

  /**
   * Mirrors the source's split for what is on screen in the HTML pins. Rendered
   * features, not querySourceFeatures: that also returns tiles kept from other
   * zoom levels, which put a stale "4 routes" under a fresh "3 routes".
   */
  private sync(): void {
    if (!this.map.getLayer('route-starts-probe')) return;
    const singles = new Set<string>();
    const found = new Map<number, { lngLat: [number, number]; count: number }>();
    // A point near a tile edge comes back once per tile; keying by id dedupes it.
    for (const feature of this.map.queryRenderedFeatures({ layers: ['route-starts-probe'] })) {
      const props = feature.properties ?? {};
      if (props.cluster && feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates;
        found.set(Number(props.cluster_id), { lngLat: [lng, lat], count: Number(props.point_count) });
      } else if (typeof props.slug === 'string') {
        singles.add(props.slug);
      }
    }
    this.singles = singles;

    for (const [id, cluster] of this.clusters) {
      if (found.has(id)) continue;
      cluster.marker.remove();
      this.clusters.delete(id);
    }
    for (const [id, { lngLat, count }] of found) {
      let cluster = this.clusters.get(id);
      if (!cluster) {
        const anchor = document.createElement('div');
        anchor.className = 'pin-anchor';
        anchor.style.zIndex = '1';
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'pin route-pin route-cluster';
        const glyph = document.createElement('span');
        glyph.className = 'pin-glyph route-pin-badge';
        setSvgIcon(glyph, activityGlyphSvg('run', 17, 2.4));
        const label = document.createElement('span');
        label.className = 'pin-label';
        element.append(glyph, label);
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          const source = this.map.getSource('route-starts') as GeoJSONSource | undefined;
          source?.getClusterExpansionZoom(id).then(
            (zoom) => this.handlers.onCluster(lngLat, zoom),
            // The data changed under the tap and the cluster is gone: nothing to zoom to.
            () => {},
          );
        });
        anchor.appendChild(element);
        const marker = new Marker({ element: anchor, anchor: 'center' }).setLngLat(lngLat).addTo(this.map);
        cluster = { marker, element, label };
        this.clusters.set(id, cluster);
      }
      cluster.marker.setLngLat(lngLat);
      cluster.label.textContent = `${count} routes`;
      cluster.element.setAttribute('aria-label', `${count} routes here, zoom in`);
    }
    this.applyVisibility();
  }

  /** A route inside a cluster has no pin of its own, unless it is the one hovered or open. */
  private applyVisibility(): void {
    for (const [slug, entry] of this.entries) {
      const shown = !this.singles || this.singles.has(slug) || slug === this.selected || slug === this.hovered;
      entry.anchor.classList.toggle('is-hidden', !shown);
    }
  }
}
