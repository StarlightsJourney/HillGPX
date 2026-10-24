import { useEffect, useState } from 'react';
import { fetchMyRoutes, useAuthUser, type MyUpload } from '../lib/auth';
import { errorText } from '../lib/api';
import { AccountOverview } from './AccountOverview';
import { AccountSettings } from './AccountSettings';
import { AuthModal } from './AuthModal';
import { ChevronLeftIcon } from './icons';
import { SiteFooter, SiteHeader } from './SiteChrome';

/**
 * The account page (#account). What people come for sits first (who you are,
 * your routes, what you saved); settings follow under their own heading, and
 * deleting the account comes last.
 */
export function AccountPage() {
  const user = useAuthUser();
  const [authOpen, setAuthOpen] = useState(false);
  const [routes, setRoutes] = useState<MyUpload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchMyRoutes()
      .then((rows) => !cancelled && setRoutes(rows))
      .catch((err: unknown) => !cancelled && setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="info-page">
      <SiteHeader sticky />
      <main className="info-page-body acct">
        <a className="acct-back" href="#map">
          <ChevronLeftIcon size={14} /> Back to map
        </a>
        {user ? (
          <>
            <AccountOverview user={user} routes={routes} error={error} />
            <h2 className="acct-settings-title">Account settings</h2>
            <AccountSettings user={user} />
          </>
        ) : (
          <div className="uploads-empty">
            <h1>Account</h1>
            <p className="profile-note">Log in to manage your account.</p>
            <button type="button" className="btn btn-dark btn-sm" onClick={() => setAuthOpen(true)}>
              Log in
            </button>
          </div>
        )}
      </main>
      <SiteFooter />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
