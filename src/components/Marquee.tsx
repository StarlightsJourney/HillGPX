import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from '../lib/dom';

/**
 * One line that never wraps or scrolls: when its content is wider than the
 * space, it drifts sideways in a seamless loop (two copies, the second hidden
 * from screen readers), pausing while hovered. Content that fits sits still,
 * and under reduced motion an overflow just ends in an ellipsis.
 */
export function Marquee({ children, className = '', speed = 40 }: { children: ReactNode; className?: string; speed?: number }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const itemRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const item = itemRef.current;
    if (!box || !item) return;
    const measure = () => setOverflow(item.scrollWidth > box.clientWidth + 1 ? item.scrollWidth : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(item);
    return () => observer.disconnect();
  }, []);

  const moving = overflow > 0 && !prefersReducedMotion();
  return (
    <span ref={boxRef} className={`marquee-line${moving ? ' moving' : ''}${overflow > 0 && !moving ? ' clipped' : ''} ${className}`}>
      <span
        className="marquee-line-track"
        style={moving ? ({ '--marquee-s': `${Math.max(6, (overflow + 48) / speed)}s` } as React.CSSProperties) : undefined}
      >
        <span ref={itemRef} className="marquee-line-item">{children}</span>
        {moving && (
          <span className="marquee-line-item" aria-hidden="true" ref={(el) => el?.setAttribute('inert', '')}>
            {children}
          </span>
        )}
      </span>
    </span>
  );
}
