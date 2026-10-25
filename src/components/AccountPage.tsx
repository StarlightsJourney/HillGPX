import { useState } from 'react';
import { useAccountRoute } from '../lib/accountRoute';
import { useAuthUser } from '../lib/auth';
import { useMyRoutes } from '../lib/myRoutes';
import { AccountIdentity } from './AccountIdentity';
import { Breadcrumb } from './AccountParts';
import { AccountRoutes } from './AccountRoutes';
import { AccountSaved } from './AccountSaved';
import { AccountStats } from './AccountStats';
import { AuthModal } from './AuthModal';
import { SiteFooter, SiteHeader } from './SiteChrome';

const VIEW_LABEL = { routes: 'Your routes', stats: 'Stats', saved: 'Saved' } as const;

/**
 * The profile (#account…): an identity card on the left and one panel on the
 * right (your routes, stats or saved), each with its own address.
 */
export function AccountPage() {
  const user = useAuthUser();
  const route = useAccountRoute();
  const { routes, error, reload } = useMyRoutes();
  const [authOpen, setAuthOpen] = useState(false);
  const view = route.page === 'account' ? route.view : 'routes';

  return (
    <div className="info-page ac">
      <SiteHeader sticky />
      <main className="ac-main">
        {user ? (
          <>
            <Breadcrumb trail={[{ label: 'Map', href: '#map' }, { label: user.username, href: '#account' }, { label: VIEW_LABEL[view] }]} />
            <div className="ac-grid">
              <AccountIdentity user={user} routes={routes} view={view} />
              <div className="ac-content">
                {view === 'routes' && <AccountRoutes user={user} routes={routes} error={error} onRetry={reload} />}
                {view === 'stats' && route.page === 'account' && (
                  <AccountStats routes={routes} error={error} onRetry={reload} tab={route.statsTab} />
                )}
                {view === 'saved' && route.page === 'account' && <AccountSaved tab={route.savedTab} />}
              </div>
            </div>
          </>
        ) : (
          <div className="ac-signed-out">
            <h1 className="ac-h2">Your profile</h1>
            <p>Log in to see your routes, stats and saved places.</p>
            <button type="button" className="ac-btn primary" onClick={() => setAuthOpen(true)}>
              Log in
            </button>
          </div>
        )}
      </main>
      <SiteFooter openSourcePill />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
