import { useEffect, useRef, useState } from 'react';
import { CheckIcon, GitHubIcon, GlobeIcon, MenuIcon } from './icons';
import { useUnits } from './UnitsContext';
import type { Units } from '../lib/units';

const REPO_URL = 'https://github.com/StarlightsJourney/HillGPX';

/**
 * `blob/HEAD` resolves to whatever the default branch is called. A hardcoded
 * `/main/` would 404 the day anyone renames it, and a broken help link is worse
 * than none because it looks like the project is abandoned.
 */
const CONTRIBUTING_URL = `${REPO_URL}/blob/HEAD/CONTRIBUTING.md`;
const README_URL = `${REPO_URL}/blob/HEAD/README.md`;

const UNIT_CHOICES: { value: Units; label: string; note: string }[] = [
  { value: 'metric', label: 'Metres', note: 'Heights in m, distances in km' },
  { value: 'imperial', label: 'Feet', note: 'Heights in ft, distances in miles' },
];

/**
 * What the menu offers, and why these and not the usual header fare.
 *
 * There is no account to sign into and nothing to save, so every row here is a
 * link to something that already exists in the repo. The three contribution
 * routes come first because the README is explicit that they are what the
 * project needs most: a verified height is a one-line diff and a route is one
 * GPX file.
 */
const MENU_LINKS: { href: string; label: string; note: string }[] = [
  {
    href: `${CONTRIBUTING_URL}#add-a-route`,
    label: 'Add a route',
    note: 'Drop a GPX in, open a pull request',
  },
  {
    href: `${CONTRIBUTING_URL}#verify-a-venues-elevation`,
    label: 'Correct an elevation',
    note: 'Most heights here are unverified seed values',
  },
  {
    href: `${CONTRIBUTING_URL}#add-a-venue`,
    label: 'Add a venue',
    note: 'A staircase, hill or carpark people train on',
  },
];

type OpenPanel = 'units' | 'menu' | null;

/**
 * The two round buttons at the right of the map header.
 *
 * Both panels live in one component so that opening either closes the other —
 * with the state split between them, the only ways to keep a single panel open
 * are a shared parent or a module-level variable, and this is the shared parent.
 */
export function HeaderControls() {
  const [open, setOpen] = useState<OpenPanel>(null);
  const units = useUnits();

  const rootRef = useRef<HTMLDivElement>(null);
  const unitsBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Dismissal, following the pattern the search dropdown already uses: a
  // document-level mousedown rather than a blur handler, because blur fires
  // before the click it belongs to and would eat the first press on a row.
  // Escape is added on top of it and, unlike an outside click, puts focus back
  // on the button — someone who opened this from the keyboard has nowhere else
  // to be, whereas a click has already chosen where focus should go.
  useEffect(() => {
    if (!open) return;

    const triggerFor = (panel: OpenPanel) =>
      panel === 'units' ? unitsBtnRef.current : menuBtnRef.current;

    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      triggerFor(open)?.focus();
      setOpen(null);
    };

    const onFocus = (e: FocusEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    rootRef.current?.querySelector<HTMLElement>('.hdr-panel [aria-checked="true"], .hdr-panel a')?.focus();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  const toggle = (panel: Exclude<OpenPanel, null>) =>
    setOpen((current) => (current === panel ? null : panel));

  const chooseUnits = (next: Units) => {
    units.setUnits(next);
    // Left open on purpose: the figures behind the panel change as you pick, so
    // closing it would hide the one thing that shows the choice took effect.
  };

  return (
    <div className="header-controls" ref={rootRef}>
      <div className="hdr-anchor">
        <button
          ref={unitsBtnRef}
          className={`hdr-btn${open === 'units' ? ' open' : ''}`}
          onClick={() => toggle('units')}
          aria-haspopup="dialog"
          aria-controls={open === 'units' ? 'units-panel' : undefined}
          aria-expanded={open === 'units'}
          aria-label={`Units — currently ${units.units === 'imperial' ? 'feet' : 'metres'}`}
          title="Units"
        >
          <GlobeIcon />
        </button>

        {open === 'units' && (
          <div className="hdr-panel hdr-panel-units" id="units-panel" role="dialog" aria-label="Units">
            <div className="hdr-group">
              <p className="hdr-title">Units</p>
              <div className="hdr-choices" role="radiogroup" aria-label="Height and distance units">
                {UNIT_CHOICES.map((choice) => {
                  const selected = units.units === choice.value;
                  return (
                    <button
                      key={choice.value}
                      className={`hdr-choice${selected ? ' selected' : ''}`}
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onKeyDown={(e) => {
                        const choices = Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
                        const index = choices.indexOf(e.currentTarget);
                        const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1
                          : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (index + 1) % choices.length
                          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (index + choices.length - 1) % choices.length : -1;
                        if (next < 0) return;
                        e.preventDefault();
                        choices[next].focus();
                        chooseUnits(UNIT_CHOICES[next].value);
                      }}
                      // Named explicitly rather than left to be computed from
                      // the contents, so the row announces "Metres" and not
                      // "Metres, heights in m, distances in km".
                      aria-label={choice.label}
                      onClick={() => chooseUnits(choice.value)}
                    >
                      <span className="hdr-choice-text">
                        <span className="hdr-choice-label">{choice.label}</span>
                        <span className="hdr-note">{choice.note}</span>
                      </span>
                      {selected && <CheckIcon />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Said out loud because converting the map's labels changes their
                unit, not the quality of the underlying measurement. Extra digits
                in feet should not suggest extra confidence in the data. */}
            <div className="hdr-group">
              <p className="hdr-note">
                Everything is measured and stored in metres; feet are converted for display, so
                they carry the same uncertainty. Map markers, filters and elevation profiles all
                follow this setting.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="hdr-anchor">
        <button
          ref={menuBtnRef}
          className={`hdr-btn hdr-btn-menu${open === 'menu' ? ' open' : ''}`}
          onClick={() => toggle('menu')}
          aria-haspopup="dialog"
          aria-controls={open === 'menu' ? 'menu-panel' : undefined}
          aria-expanded={open === 'menu'}
          aria-label="Menu"
          title="Menu"
        >
          <MenuIcon />
        </button>

        {open === 'menu' && (
          <div className="hdr-panel hdr-panel-menu" id="menu-panel" role="dialog" aria-label="Menu">
            <div className="hdr-group">
              {MENU_LINKS.map((link) => (
                <a
                  key={link.href}
                  className="hdr-item"
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(null)}
                >
                  <span className="hdr-item-label">{link.label}</span>
                  <span className="hdr-note">{link.note}</span>
                </a>
              ))}
            </div>

            <div className="hdr-group">
              <a
                className="hdr-item"
                href={`${REPO_URL}/issues`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(null)}
              >
                <span className="hdr-item-label">Report something wrong</span>
                <span className="hdr-note">A closed staircase, a wrong height, a bug</span>
              </a>
              <a
                className="hdr-item hdr-item-row"
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(null)}
              >
                <GitHubIcon size={16} />
                <span className="hdr-item-label">Source on GitHub</span>
              </a>
            </div>

            <div className="hdr-group">
              <p className="hdr-title">About</p>
              <p className="hdr-note">
                A map of every hill, staircase and tall HDB block in Singapore, with the climb each
                one gives you. No accounts and no server — every venue and route is a file in a
                public repository, so a wrong number is a one-line fix.
              </p>
              <p className="hdr-note">
                Blocks come from data.gov.sg and are placed with OneMap; elevation profiles are
                re-sampled against a bundled terrain model rather than read from your GPX, which is
                too noisy to trust. Most venue heights are still unverified.
              </p>
              <a
                className="hdr-link"
                href={`${README_URL}#data-sources-and-licensing`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(null)}
              >
                Data sources and licensing
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
