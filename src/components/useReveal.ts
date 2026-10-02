import { useEffect, type RefObject } from 'react';

/**
 * Sections inside `root` fade up the first time they scroll into view, so a
 * long page feels like it is arriving rather than sitting there. Honours
 * prefers-reduced-motion by doing nothing.
 */
export function useReveal(root: RefObject<HTMLElement>, resetKey: string, selector = '.venue-detail-section, .venue-detail-intro, .plan-card'): void {
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = [...el.querySelectorAll<HTMLElement>(selector)];
    targets.forEach((target) => target.classList.add('reveal'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      },
      { root: el, rootMargin: '0px 0px -8% 0px' },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [root, resetKey, selector]);
}
