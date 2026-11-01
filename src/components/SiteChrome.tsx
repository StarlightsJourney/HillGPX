import { useState, type ReactNode } from 'react';
import { openImportHere, requestAddPlace } from '../lib/contribute';
import { AccountMenu } from './AccountMenu';
import { HeaderControls } from './HeaderControls';
import { CoverageModal, useCoverage } from './Coverage';
import { Mark } from './icons';
import { OpenSourceInline } from './OpenSourceNotice';

/**
 * The logo lockup: the mark and the name in one brand colour, set in Nunito
 * (rounded, like Airbnb's wordmark) at a medium-bold weight with tight
 * tracking. Only these seven letters of the face are loaded (see index.html).
 */
export function Wordmark({ size = 28, href = '#' }: { size?: number; href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="hillGPX home">
      <Mark size={size} />
      <span className="wordmark-text">hillGPX</span>
    </a>
  );
}

/**
 * The one header every page uses: logo on the left, the page's own control
 * (search) in the centre, and the same actions on the right. It keeps one
 * fixed size, so a sticky header never resizes on scroll.
 */
export function SiteHeader({ center, sticky = false }: { center?: ReactNode; sticky?: boolean }) {
  return (
    <header className={`site-header${sticky ? ' sticky' : ''}`}>
      <div className="site-header-row">
        <div className="site-header-left">
          <Wordmark />
        </div>
        <div className="site-header-center">{center}</div>
        <div className="site-header-right">
          <a className="site-header-cta" href="#import" onClick={openImportHere} aria-label="Upload GPX" data-tip="Upload GPX">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span className="site-header-cta-label" aria-hidden="true">Upload GPX</span>
          </a>
          <HeaderControls />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * The same footer on every page. On the map it sits at the end of the list,
 * so it only shows once you have scrolled past the results.
 */
export function SiteFooter({ openSourcePill = false }: { openSourcePill?: boolean }) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-cols">
          <div>
            <h3>Explore</h3>
            <a href="#map">Map of climbs</a>
            <a href="#routes">Routes</a>
            <button type="button" className="site-footer-link" aria-haspopup="dialog" onClick={() => setCoverageOpen(true)}>
              What's mapped
            </button>
          </div>
          <div>
            <h3>Contribute</h3>
            <a href="#import" onClick={openImportHere}>Upload GPX</a>
            <button type="button" className="site-footer-link" onClick={requestAddPlace}>
              Add a missing place
            </button>
          </div>
          <div>
            <h3>Project</h3>
            <a href="#community">How we run and fund it</a>
            <a href="#data">Data sources and licences</a>
          </div>
          <div>
            <h3>About</h3>
            <a href="#privacy">Privacy</a>
            <a href="#terms">Contributions and licences</a>
            <a href="#contact">Contact</a>
          </div>
        </div>
        <div className="site-footer-base">
          {openSourcePill && <OpenSourceInline />}
          <span>© hillGPX · Code MIT · Routes and reviews CC BY 4.0 · Photos CC BY-SA 4.0</span>
          <span className="site-footer-credits">
            Data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>,{' '}
            <a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a>,{' '}
            <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>,{' '}
            <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain</a>,{' '}
            <a href="https://data.gov.sg" target="_blank" rel="noreferrer">data.gov.sg</a>,{' '}
            <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia</a>,{' '}
            <a href="https://www.mapillary.com" target="_blank" rel="noreferrer">Mapillary</a>
          </span>
        </div>
      </div>
      {coverageOpen && <FooterCoverage onClose={() => setCoverageOpen(false)} />}
    </footer>
  );
}

/** "What's mapped", opened from the footer; the numbers load only once it is asked for. */
function FooterCoverage({ onClose }: { onClose: () => void }) {
  const coverage = useCoverage();
  return coverage ? <CoverageModal coverage={coverage} onClose={onClose} /> : null;
}
