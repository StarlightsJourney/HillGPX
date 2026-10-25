import type { ReactNode } from 'react';
import type { Units } from '../lib/units';
import { useUnits } from './UnitsContext';

export interface Crumb {
  label: string;
  href?: string;
}

/** `Map / {username} / {current view}`: every crumb but the last is a link. */
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="ac-crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${crumb.label}-${index}`}>
              {last || !crumb.href ? (
                <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
              ) : (
                <a href={crumb.href}>{crumb.label}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  href: string;
}

/** Tabs that are real links, so each one has its own address. */
export function LinkTabs<T extends string>({ label, tabs, current }: { label: string; tabs: TabSpec<T>[]; current: T }) {
  return (
    <nav className="ac-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <a key={tab.id} href={tab.href} aria-current={tab.id === current ? 'page' : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

/** A few nested contour rings, drawn once and kept faint behind a card. */
export function ContourArt({ className = '' }: { className?: string }) {
  return (
    <svg className={`ac-contours ${className}`} viewBox="0 0 600 240" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M330 120c10-62 90-100 170-88 74 11 124 62 114 118-10 58-76 94-152 86-62-6-98-36-132-116z" />
        <path d="M372 122c8-42 64-66 120-58 50 7 84 41 76 77-7 38-53 62-105 57-43-4-69-24-91-76z" />
        <path d="M410 124c6-24 40-38 74-33 31 5 52 24 47 48-5 24-33 38-64 36-26-2-43-14-57-51z" />
        <path d="M446 126c4-12 21-19 38-17 17 2 26 12 24 24-3 12-18 19-33 18-13-1-22-7-29-25z" />
        <path d="M250 210c36-22 78-17 110 10" />
        <path d="M196 176c54-36 118-30 168 12" />
      </g>
    </svg>
  );
}

const UNIT_CHOICES: { id: Units; label: string }[] = [
  { id: 'metric', label: 'Metric' },
  { id: 'imperial', label: 'Imperial' },
];

/** A compact Metric / Imperial switch bound to the same setting as the header's m / ft button. */
export function UnitsSwitch() {
  const { units, setUnits } = useUnits();
  return (
    <div className="ac-seg" role="radiogroup" aria-label="Units">
      {UNIT_CHOICES.map((choice) => (
        <button
          key={choice.id}
          type="button"
          role="radio"
          aria-checked={units === choice.id}
          className={units === choice.id ? 'on' : ''}
          onClick={() => setUnits(choice.id)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <section className="ac-panel" aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function pluralise(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
