import type { ReactNode } from 'react';
import { REPO_URL, addPlaceUrl } from '../lib/contribute';
import { HeaderControls } from './HeaderControls';
import { MilestoneBar } from './Milestones';
import { ChevronLeftIcon, GitHubIcon, Mark } from './icons';

/**
 * The one header every page uses: logo on the left, the page's own control
 * (tabs, search) in the centre, and the same two actions on the right. Kept
 * compact and centred in a narrow column so the eye lands in the middle.
 */
export function SiteHeader({ center, onBack, sticky = false }: { center?: ReactNode; onBack?: () => void; sticky?: boolean }) {
  return (
    <header className={`site-header${sticky ? ' sticky' : ''}`}>
      <div className="site-header-row">
        <div className="site-header-left">
          {onBack && (
            <button type="button" className="site-header-back" onClick={onBack} aria-label="Back">
              <ChevronLeftIcon size={18} />
            </button>
          )}
          <a className="wordmark" href="#" aria-label="hillGPX home">
            <Mark size={28} />
            <span className="wordmark-text">
              hill<span className="dot">GPX</span>
            </span>
          </a>
        </div>
        <div className="site-header-center">{center}</div>
        <div className="site-header-right">
          <a className="site-header-cta" href="#import" aria-label="Add a GPX" title="Add a GPX">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span className="hide-narrow">Add a GPX</span>
          </a>
          <HeaderControls />
        </div>
      </div>
      <MilestoneBar />
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
            <a href="#import">Add a GPX</a>
            <a href={addPlaceUrl()} target="_blank" rel="noreferrer">Add a missing place</a>
            <a href={`${REPO_URL}/blob/HEAD/CONTRIBUTING.md`} target="_blank" rel="noreferrer">Contributor guide</a>
          </div>
          <div>
            <h3>Project</h3>
            <a href={`${REPO_URL}/blob/HEAD/docs/COMMUNITY.md`} target="_blank" rel="noreferrer">How we run and fund it</a>
            <a href={`${REPO_URL}/blob/HEAD/README.md#data-sources-and-licensing`} target="_blank" rel="noreferrer">Data sources and licences</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source code</a>
          </div>
        </div>
        <div className="site-footer-base">
          <span>© hillGPX · Free and open source (MIT) · Built by its community</span>
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
