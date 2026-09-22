import { describe, expect, it } from 'vitest';
import { parseSvg, setSvgIcon, textSpan } from './dom';

describe('dom helpers', () => {
  it('parses a valid SVG string', () => {
    const svg = parseSvg('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('circle')).not.toBeNull();
  });

  it('falls back to an empty svg for malformed input', () => {
    const svg = parseSvg('not svg');
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('sets an SVG icon without innerHTML', () => {
    const container = document.createElement('span');
    setSvgIcon(container, '<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>');
    expect(container.innerHTML).toContain('<rect');
  });

  it('creates a text-only span', () => {
    const span = textSpan('hello', 'label');
    expect(span.tagName.toLowerCase()).toBe('span');
    expect(span.className).toBe('label');
    expect(span.textContent).toBe('hello');
    expect(span.innerHTML).toBe('hello');
  });
});
