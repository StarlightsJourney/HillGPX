import type { ReactNode } from 'react';
import { REPO_URL, addPlaceUrl, openImportHere } from '../lib/contribute';
import { HeaderControls } from './HeaderControls';
import { MilestoneBar } from './Milestones';
import { GitHubIcon, Mark } from './icons';

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
 * The one header every page uses. On top, the community progress strip; below
 * it, logo on the left, the page's own control (tabs, search) in the centre,
 * and the same two actions on the right. When sticky (landing), the strip
 * scrolls away and the logo row stays: the header keeps one fixed size, it is
 * only offset by the strip's height, so nothing resizes on scroll.
 */
export function SiteHeader({ center, sticky = false }: { center?: ReactNode; sticky?: boolean }) {
  return (
    <header className={`site-header${sticky ? ' sticky' : ''}`}>
      <MilestoneBar />
      <div className="site-header-row">
        <div className="site-header-left">
          <Wordmark />
        </div>
        <div className="site-header-center">{center}</div>
        <div className="site-header-right">
          <a className="site-header-cta" href="#import" onClick={openImportHere} aria-label="Add a GPX" data-tip="Add a GPX">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span className="hide-narrow">Add a GPX</span>
          </a>
          <HeaderControls />
        </div>
      </div>
    </header>
  );
}

/**
 * The same footer on every page. On the map it sits at the end of the list,
 * so it only shows once you have scrolled past the results.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-cols">
          <div>
            <h3>Explore</h3>
            <a href="#map">Map of climbs</a>
            <a href="#routes">Routes</a>
          </div>
          <div>
            <h3>Contribute</h3>
            <a href="#import" onClick={openImportHere}>Add a GPX</a>
            <a href={addPlaceUrl()} target="_blank" rel="noreferrer">Add a missing place</a>
            <a href={`${REPO_URL}/blob/HEAD/CONTRIBUTING.md`} target="_blank" rel="noreferrer">Contributor guide</a>
          </div>
          <div>
            <h3>Project</h3>
            <a href={`${REPO_URL}/blob/HEAD/docs/COMMUNITY.md`} target="_blank" rel="noreferrer">How we run and fund it</a>
            <a href={`${REPO_URL}/blob/HEAD/README.md#data-sources-and-licensing`} target="_blank" rel="noreferrer">Data sources and licences</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source code</a>
          </div>
          <div>
            <h3>About</h3>
            <a href="#privacy">Privacy</a>
            <a href="#terms">Contributions and licences</a>
            <a href="#contact">Contact</a>
          </div>
        </div>
        <div className="site-footer-base">
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
          <a className="site-footer-gh" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub">
            <GitHubIcon size={16} />
          </a>
        </div>
      </div>
    </footer>
  );
}
