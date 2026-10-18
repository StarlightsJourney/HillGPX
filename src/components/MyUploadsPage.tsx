import { useState } from 'react';
import { useAuthUser } from '../lib/auth';
import { AuthModal } from './AuthModal';
import { UploadsList } from './MyUploadsModal';
import { SiteFooter, SiteHeader } from './SiteChrome';

/** The uploads page (#uploads) — a signed-in user's published GPX routes. */
export function MyUploadsPage() {
  const user = useAuthUser();
  const [authOpen, setAuthOpen] = useState(false);
  return (
    <div className="info-page">
      <SiteHeader sticky />
      <main className="info-page-body">
        <h1>My uploads</h1>
        {user ? (
          <UploadsList />
        ) : (
          <div className="uploads-empty">
            <p className="profile-note">Log in to see the routes you have published.</p>
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
