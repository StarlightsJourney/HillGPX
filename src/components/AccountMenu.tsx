import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/api';
import { logOut, useAuthUser } from '../lib/auth';
import { AuthModal } from './AuthModal';
import { MyUploadsModal } from './MyUploadsModal';
import { ProfileModal } from './ProfileModal';
import { UserIcon } from './icons';

/**
 * The header's right-most control. Signed out it is a round person button
 * that opens the "Log in or sign up" dialog; signed in it shows the username
 * initial and a small menu with sign-out, like Airbnb's profile chip.
 */
export function AccountMenu() {
  const user = useAuthUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="account" ref={rootRef}>
      <button
        type="button"
        className={`account-btn${user ? ' in' : ''}`}
        aria-label={user ? `Account: ${user.username}` : 'Log in or sign up'}
        aria-haspopup={user ? 'menu' : undefined}
        aria-expanded={user ? menuOpen : undefined}
        title={user ? user.username : 'Log in or sign up'}
        onClick={() => (user ? setMenuOpen((open) => !open) : setAuthOpen(true))}
      >
        {user ? (
          user.avatarUrl ? (
            <img className="account-avatar" src={`${API_BASE}${user.avatarUrl}`} alt="" />
          ) : (
            <span className="account-initial">{user.username.slice(0, 1).toUpperCase()}</span>
          )
        ) : (
          <>
            <UserIcon size={16} />
            <span className="hide-narrow">Log in</span>
          </>
        )}
      </button>
      {menuOpen && user && (
        <div className="account-menu" role="menu">
          <p className="account-name">
            <strong>{user.username}</strong>
            <span>{user.email}</span>
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setUploadsOpen(true);
            }}
          >
            My uploads
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setProfileOpen(true);
            }}
          >
            Account settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void logOut();
            }}
          >
            Log out
          </button>
        </div>
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {uploadsOpen && <MyUploadsModal onClose={() => setUploadsOpen(false)} />}
    </div>
  );
}
