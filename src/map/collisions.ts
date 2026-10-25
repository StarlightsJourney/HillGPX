/** A pin's box on screen, centred on its anchor point, in CSS pixels. */
export interface PinBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Always shown (the open or hovered route), even over another forced pin. */
  forced?: boolean;
}

/**
 * Which pins to show so none covers another. Greedy in the order given, so
 * pass the most important first: a pin shows unless its box, grown by `gap`
 * on every side, overlaps one already shown. Forced pins always show and
 * still push others out.
 */
export function placePins(boxes: readonly PinBox[], gap = 0): Set<string> {
  const placed: PinBox[] = [];
  const shown = new Set<string>();
  const overlaps = (a: PinBox, b: PinBox) =>
    Math.abs(a.x - b.x) * 2 < a.width + b.width + gap * 2 && Math.abs(a.y - b.y) * 2 < a.height + b.height + gap * 2;
  for (const box of [...boxes.filter((b) => b.forced), ...boxes.filter((b) => !b.forced)]) {
    if (!box.forced && placed.some((other) => overlaps(box, other))) continue;
    placed.push(box);
    shown.add(box.id);
  }
  return shown;
}
