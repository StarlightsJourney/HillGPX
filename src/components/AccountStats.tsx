import { useMemo } from 'react';
import { accountHref, type StatsTab } from '../lib/accountRoute';
import type { MyUpload } from '../lib/auth';
import { openImportHere } from '../lib/contribute';
import { ContourArt, LinkTabs, Panel, pluralise } from './AccountParts';
import { useUnits } from './UnitsContext';
import { ArrowLeftIcon, UploadIcon } from './icons';

interface Props {
  routes: MyUpload[] | null;
  error: string | null;
  onRetry: () => void;
  tab: StatsTab;
}

function BackToRoutes() {
  return (
    <a className="ac-back" href={accountHref.routes} aria-label="Back to your routes">
      <ArrowLeftIcon size={20} />
    </a>
  );
}

/** Panel: Stats. Everything here is computed from the routes the account already holds. */
export function AccountStats({ routes, error, onRetry, tab }: Props) {
  const units = useUnits();
  const facts = useMemo(() => {
    if (!routes || routes.length === 0) return null;
    const downloads = routes.reduce((sum, route) => sum + route.downloads, 0);
    const gainM = routes.reduce((sum, route) => sum + route.gainM, 0);
    const biggest = routes.reduce((best, route) => (route.gainM > best.gainM ? route : best));
    const popular = routes.reduce((best, route) => (route.downloads > best.downloads ? route : best));
    return { downloads, gainM, biggest, popular, byDownloads: [...routes].sort((a, b) => b.downloads - a.downloads) };
  }, [routes]);

  const head = (
    <div className="ac-panel-head">
      <BackToRoutes />
      <h2 className="ac-h2" id="ac-stats-h">
        Stats
      </h2>
    </div>
  );

  if (error) {
    return (
      <Panel labelledBy="ac-stats-h">
        {head}
        <div className="ac-error" role="alert">
          <p>{error}</p>
          <button type="button" className="ac-btn soft" onClick={onRetry}>
            Try again
          </button>
        </div>
      </Panel>
    );
  }
  if (!routes) {
    return (
      <Panel labelledBy="ac-stats-h">
        {head}
        <div className="ac-list-skel" role="status" aria-label="Loading your stats">
          <span className="ac-skel tall" aria-hidden="true" />
        </div>
      </Panel>
    );
  }
  if (!facts) {
    return (
      <Panel labelledBy="ac-stats-h">
        {head}
        <div className="ac-empty">
          <p className="ac-empty-line">Your climbing adds up here</p>
          <a className="ac-btn primary" href="#import" onClick={openImportHere}>
            <UploadIcon size={16} /> Upload a GPX file
          </a>
        </div>
      </Panel>
    );
  }

  const maxDownloads = Math.max(1, ...facts.byDownloads.map((route) => route.downloads));

  return (
    <Panel labelledBy="ac-stats-h">
      {head}
      <LinkTabs
        label="Stats views"
        current={tab}
        tabs={[
          { id: 'overview', label: 'Overview', href: accountHref.stats('overview') },
          { id: 'by-route', label: 'By route', href: accountHref.stats('by-route') },
        ]}
      />

      {tab === 'overview' ? (
        <>
          <div className="ac-hero-stat">
            <ContourArt className="ac-hero-art" />
            <p className="ac-hero-number" aria-label={`Total elevation gain ${units.height(facts.gainM)}`}>
              {units.height(facts.gainM)}
            </p>
            <p className="ac-hero-sub">of climbing shared across {pluralise(routes.length, 'route', 'routes')}</p>
          </div>
          <div className="ac-tiles">
            <div className="ac-tile">
              <span>Total downloads</span>
              <strong>{facts.downloads.toLocaleString()}</strong>
            </div>
            <div className="ac-tile">
              <span>Biggest climb</span>
              <strong>{units.height(facts.biggest.gainM)}</strong>
              <small>{facts.biggest.name}</small>
            </div>
            <div className="ac-tile">
              <span>Most downloaded</span>
              {facts.popular.downloads > 0 ? (
                <>
                  <strong>{pluralise(facts.popular.downloads, 'download', 'downloads')}</strong>
                  <small>{facts.popular.name}</small>
                </>
              ) : (
                <strong className="ac-none">None yet</strong>
              )}
            </div>
          </div>
        </>
      ) : (
        <ul className="ac-bars" aria-label="Downloads per route">
          {facts.byDownloads.map((route) => (
            <li key={route.slug}>
              <span className="ac-bar-name">{route.name}</span>
              <span className="ac-bar-track" aria-hidden="true">
                <span className="ac-bar-fill" style={{ width: `${(route.downloads / maxDownloads) * 100}%` }} />
              </span>
              <span className="ac-bar-value">{route.downloads.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
