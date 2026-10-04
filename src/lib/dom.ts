/**
 * DOM helpers that avoid assigning to innerHTML with anything that could carry
 * user input. Static SVG strings are parsed through DOMParser and returned as
 * detached elements so callers can append them safely.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Parse a static SVG markup string into an SVGElement. The input must be a
 * trusted, self-contained SVG; this is for icons and glyphs, not arbitrary HTML.
 */
export function parseSvg(svg: string): SVGElement {
  // Without the namespace the XML parser returns a plain <svg> element that
  // browsers lay out but never paint, so every icon silently vanished.
  const markup = /^<svg\b[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/^<svg\b/, `<svg xmlns="${SVG_NS}"`);
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    const fallback = document.createElementNS(SVG_NS, 'svg');
    fallback.setAttribute('viewBox', '0 0 24 24');
    return fallback;
  }
  return root as unknown as SVGElement;
}

/**
 * Replace every child of an element with a single parsed SVG icon.
 */
export function setSvgIcon(container: HTMLElement, svg: string): void {
  container.replaceChildren(parseSvg(svg));
}

/**
 * Build an element with a single text child. Useful for labels that used to be
 * interpolated into innerHTML.
 */
export function textSpan(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

let scrollLocks = 0;

/**
 * Stop the page scrolling behind a dialog. Hiding the overflow also removes a
 * classic (non-overlay) scrollbar, which shifted the whole page sideways by
 * its width every time a dialog opened; the body is padded by that width
 * while locked so nothing moves. Nested locks (a lightbox over a dialog)
 * share one. Returns the unlock function.
 */
export function lockPageScroll(): () => void {
  const { body, documentElement } = document;
  if (scrollLocks++ === 0) {
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--scrollLocks === 0) {
      body.style.overflow = '';
      body.style.paddingRight = '';
    }
  };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
