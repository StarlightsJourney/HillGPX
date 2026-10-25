import { useEffect, useRef, useState } from 'react';
import { accountHref, SETTINGS_SECTIONS, useAccountRoute, type SettingsSection } from '../lib/accountRoute';
import { useAuthUser, type AuthUser } from '../lib/auth';
import { Breadcrumb } from './AccountParts';
import { AuthModal } from './AuthModal';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { SettingsAccount } from './SettingsAccount';
import { SettingsData } from './SettingsData';
import { SettingsPreferences } from './SettingsPreferences';
import { SettingsProfile } from './SettingsProfile';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { ArchiveIcon, ShieldIcon, SlidersIcon, UserIcon } from './icons';

const SECTION_LABEL: Record<SettingsSection, string> = {
  profile: 'Profile',
  preferences: 'Preferences',
  account: 'Account',
  data: 'Your data',
};

const SECTION_ICON: Record<SettingsSection, JSX.Element> = {
  profile: <UserIcon size={20} />,
  preferences: <SlidersIcon />,
  account: <ShieldIcon />,
  data: <ArchiveIcon />,
};

/**
 * A username edit handed to the next mount. Leaving the page unmounts it, so
 * when someone cancels the "unsaved changes" prompt the page re-opens and picks
 * the field back up from here (read once, then cleared).
 */
let restoredDraft: string | null = null;

const LEAVE_PROMPT = 'You have unsaved changes on this page. Leave without saving?';

/**
 * Settings (#settings/<section>): a nav card on the left, one section on the
 * right. The username draft lives here so moving between sections keeps it.
 */
export function SettingsPage() {
  const user = useAuthUser();
  const route = useAccountRoute();
  const section = route.page === 'settings' ? route.section : 'profile';
  const [authOpen, setAuthOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(() => {
    const kept = restoredDraft;
    restoredDraft = null;
    return kept;
  });
  // Set while the delete dialog is open; the dialog outlives the signed-in
  // state so it can say "deleted" after the account is gone.
  const [deleting, setDeleting] = useState<AuthUser | null>(null);

  const dirty = user !== null && draft !== null && draft.trim() !== user.username;
  const latest = useRef(draft);
  latest.current = draft;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onHashChange = (event: HashChangeEvent) => {
      // Moving between settings sections keeps the draft; leaving them asks.
      if (window.location.hash.startsWith('#settings')) return;
      if (window.confirm(LEAVE_PROMPT)) return;
      restoredDraft = latest.current;
      window.location.replace(event.oldURL);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [dirty]);

  return (
    <div className="info-page ac">
      <SiteHeader sticky />
      <main className="ac-main">
        {user ? (
          <>
            <Breadcrumb
              trail={[
                { label: 'Map', href: '#map' },
                { label: user.username, href: accountHref.routes },
                { label: 'Settings', href: accountHref.settings() },
                { label: SECTION_LABEL[section] },
              ]}
            />
            <div className="ac-settings-grid">
              <div className="ac-settings-side">
                <h1 className="ac-h1">Settings</h1>
                <nav className="ac-nav card" aria-label="Settings sections">
                  {SETTINGS_SECTIONS.map((id) => (
                    <a key={id} href={accountHref.settings(id)} aria-current={id === section ? 'page' : undefined}>
                      {SECTION_ICON[id]}
                      <span className="ac-nav-label">{SECTION_LABEL[id]}</span>
                    </a>
                  ))}
                </nav>
              </div>
              <div className="ac-settings-body">
                <h2 className="ac-h2">{SECTION_LABEL[section]}</h2>
                {section === 'profile' && <SettingsProfile user={user} draft={draft} onDraft={setDraft} />}
                {section === 'preferences' && <SettingsPreferences />}
                {section === 'account' && <SettingsAccount user={user} onDelete={() => setDeleting(user)} />}
                {section === 'data' && <SettingsData />}
              </div>
            </div>
          </>
        ) : (
          !deleting && (
            <div className="ac-signed-out">
              <h1 className="ac-h2">Settings</h1>
              <p>Log in to manage your profile and account.</p>
              <button type="button" className="ac-btn primary" onClick={() => setAuthOpen(true)}>
                Log in
              </button>
            </div>
          )
        )}
      </main>
      <SiteFooter openSourcePill />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {deleting && <DeleteAccountDialog user={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
