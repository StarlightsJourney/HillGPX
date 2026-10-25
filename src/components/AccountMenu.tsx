import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { accountHref } from '../lib/accountRoute';
import { logOut, useAuthUser } from '../lib/auth';
import { REPO_URL } from '../lib/contribute';
import { useMyRoutes } from '../lib/myRoutes';
import { useSavedPlaces, useSavedRoutes } from '../lib/saved';
import { AuthModal } from './AuthModal';
import { Avatar } from './Avatar';
import { ChevronRightIcon, GearIcon, HeartIcon, HelpIcon, LogOutIcon, RouteLineIcon, UserIcon } from './icons';

/**
 * The header's right-most control. Signed out it is a round person button
 * that opens the "Log in or sign up" dialog; signed in it is the avatar, which
 * opens a menu: profile, your routes, saved, settings, help and log out.
 *
 * Follows the WAI-ARIA menu button pattern: Enter, Space or the arrow keys
 * open it onto the first item, the arrows (and Home/End) move between items,
 * Escape closes it and puts focus back on the avatar.
 */
export function AccountMenu() {
  const user = useAuthUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Opened from the keyboard: focus moves onto the first (or last) item.
  const focusOnOpen = useRef<'first' | 'last' | null>(null);

  const { routes } = useMyRoutes();
  const savedCount = useSavedRoutes().size + useSavedPlaces().size;

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const close = (returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
      // A click on empty page leaves focus nowhere; hand it back to the avatar.
      setTimeout(() => {
        if (document.activeElement === document.body) triggerRef.current?.focus();
      }, 0);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || !focusOnOpen.current) return;
    const list = items();
    (focusOnOpen.current === 'last' ? list[list.length - 1] : list[0])?.focus();
    focusOnOpen.current = null;
  }, [menuOpen]);

  const onTriggerKey = (event: KeyboardEvent) => {
    if (!user) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusOnOpen.current = event.key === 'ArrowUp' ? 'last' : 'first';
      setMenuOpen(true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      focusOnOpen.current = 'first';
      setMenuOpen((open) => !open);
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      event.preventDefault();
      list[(index + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') setMenuOpen(false);
  };

  return (
    <div className="account" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`account-btn${user ? ' in' : ''}`}
        aria-label={user ? `Account: ${user.username}` : 'Log in or sign up'}
        aria-haspopup={user ? 'menu' : undefined}
        aria-expanded={user ? menuOpen : undefined}
        title={user ? user.username : 'Log in or sign up'}
        onKeyDown={onTriggerKey}
        onClick={(event) => {
          if (!user) return setAuthOpen(true);
          // A keyboard "click" already ran in onKeyDown; this is the pointer.
          if (event.detail > 0) setMenuOpen((open) => !open);
        }}
      >
        {user ? (
          user.avatarUrl ? (
            <img className="account-avatar" src={user.avatarUrl} alt="" />
          ) : (
            <span className="account-initial">{user.username.slice(0, 1).toUpperCase()}</span>
          )
        ) : (
          <UserIcon size={16} />
        )}
      </button>
      {menuOpen && user && (
        <div className="account-menu v2" role="menu" aria-label="Account" ref={menuRef} onKeyDown={onMenuKey}>
          <a className="am-head" role="menuitem" tabIndex={-1} href={accountHref.routes} onClick={() => close(false)}>
            <Avatar url={user.avatarUrl} username={user.username} size={44} />
            <span className="am-head-text">
              <strong>{user.username}</strong>
              <small>Show my profile</small>
            </span>
            <ChevronRightIcon size={16} />
          </a>
          <div className="am-group">
            <a className="am-item" role="menuitem" tabIndex={-1} href={accountHref.routes} onClick={() => close(false)}>
              <RouteLineIcon />
              <span>Your routes</span>
              {routes && <em>{routes.length}</em>}
            </a>
            <a className="am-item" role="menuitem" tabIndex={-1} href={accountHref.saved()} onClick={() => close(false)}>
              <HeartIcon size={20} />
              <span>Saved</span>
              <em>{savedCount}</em>
            </a>
            <a className="am-item" role="menuitem" tabIndex={-1} href={accountHref.settings()} onClick={() => close(false)}>
              <GearIcon />
              <span>Settings</span>
            </a>
          </div>
          <div className="am-group muted">
            <a
              className="am-item"
              role="menuitem"
              tabIndex={-1}
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer"
              onClick={() => close(false)}
            >
              <HelpIcon />
              <span>Help and feedback</span>
            </a>
            <button
              type="button"
              className="am-item"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(false);
                void logOut();
              }}
            >
              <LogOutIcon />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
