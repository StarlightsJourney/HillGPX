import { useEffect, useRef } from 'react';
import { Map, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Venue } from '../types';
import { formatHeight } from '../lib/units';
import { venueHeight } from '../lib/venues';
import { glyphSvg } from '../lib/venueGlyphs';
import { parseSvg, textSpan } from '../lib/dom';
import { MAP_STYLE_URL } from '../map/constants';
import { useUnits } from './UnitsContext';

export function MiniMap({ venue }: { venue: Venue }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { units } = useUnits();

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [venue.lng, venue.lat],
      zoom: 14,
      interactive: false,
      attributionControl: { compact: true },
    });
    const collapseAttribution = () => {
      const element = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      if (element instanceof HTMLDetailsElement) element.open = false;
      element?.classList.remove('maplibregl-compact-show');
    };
    collapseAttribution();
    map.on('load', collapseAttribution);
    const height = venueHeight(venue);
    const label = height ? formatHeight(height.value, units) : venue.name;
    const anchor = document.createElement('div');
    anchor.className = 'pin-anchor';
    const marker = document.createElement('div');
    marker.className = 'pin is-selected';
    marker.setAttribute('aria-label', `${venue.name}, ${label}`);
    const glyph = document.createElement('span');
    glyph.className = 'pin-glyph';
    glyph.appendChild(parseSvg(glyphSvg(venue.type)));
    marker.appendChild(glyph);
    marker.appendChild(textSpan(label, 'pin-label'));
    anchor.appendChild(marker);
    const venueMarker = new Marker({ element: anchor, anchor: 'center' })
      .setLngLat([venue.lng, venue.lat])
      .addTo(map);
    return () => {
      venueMarker.remove();
      map.remove();
    };
  }, [venue, units]);

  return <div ref={containerRef} className="mini-map" aria-label={`Map showing ${venue.name}`} />;
}
