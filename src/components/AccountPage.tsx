import { useState } from 'react';
import { useAuthUser } from '../lib/auth';
import { AuthModal } from './AuthModal';
import { ProfileForm } from './ProfileModal';
import { SiteFooter, SiteHeader } from './SiteChrome';

/** The account settings page (#account) — same content as the old sheet. */
export function AccountPage() {
  const user = useAuthUser();
  const [authOpen, setAuthOpen] = useState(false);
  return (
    <div className="info-page">
      <SiteHeader sticky />
      <main className="info-page-body">
        <h1>Account</h1>
        {user ? (
          <ProfileForm />
        ) : (
          <div className="uploads-empty">
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
