import { useEffect, useRef, useState, type FormEvent } from 'react';
import { changePassword, changeUsername, removeAvatar, uploadAvatar, type AuthUser } from '../lib/auth';
import { errorText } from '../lib/api';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { CheckIcon } from './icons';
import { Avatar, prepareAvatar } from './Avatar';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

/** What is wrong with a username as typed, or null when it is fine (or unchanged). */
function usernameProblem(value: string, current: string): string | null {
  const name = value.trim();
  if (name === current) return null;
  if (name.length < 3) return 'Use at least 3 characters.';
  if (name.length > 24) return 'Use 24 characters or fewer.';
  if (!USERNAME_RE.test(name)) return 'Use only letters, numbers, dots, dashes or underscores.';
  return null;
}

interface Drafts {
  username: string | null;
  currentPw: string;
  newPw: string;
}

/**
 * Drafts handed to the next mount. Leaving the page unmounts it, so when
 * someone cancels the "unsaved changes" prompt the page is re-opened and picks
 * its fields back up from here (read once, then cleared).
 */
let restoredDrafts: Drafts | null = null;

const LEAVE_PROMPT = 'You have unsaved changes on this page. Leave without saving?';

const PROVIDER_LABEL: Record<string, string> = { google: 'Google', email: 'Email and password' };

/**
 * Settings, lowest priority on the account page: how you appear (photo and
 * username), how you sign in, and deleting the account. Each card saves on its
 * own and reports the result right under the control that was used.
 */
export function AccountSettings({ user }: { user: AuthUser }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [start] = useState(() => {
    const drafts = restoredDrafts;
    restoredDrafts = null;
    return drafts;
  });
  const [usernameDraft, setUsernameDraft] = useState<string | null>(start?.username ?? null);
  const [currentPw, setCurrentPw] = useState(start?.currentPw ?? '');
  const [newPw, setNewPw] = useState(start?.newPw ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ at: string; text: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const hasPassword = user.providers.includes('email');
  const username = usernameDraft ?? user.username;
  const problem = usernameProblem(username, user.username);
  const usernameChanged = username.trim() !== user.username;
  const newPwShort = newPw.length > 0 && newPw.length < 8;
  const methods = user.providers.map((provider) => PROVIDER_LABEL[provider] ?? provider);

  // Unsaved edits: ask before a reload, tab close, or any move to another page.
  const dirty = (usernameChanged || currentPw !== '' || newPw !== '') && !deleteOpen;
  const latest = useRef<Drafts>({ username: usernameDraft, currentPw, newPw });
  latest.current = { username: usernameDraft, currentPw, newPw };
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onHashChange = (event: HashChangeEvent) => {
      if (window.confirm(LEAVE_PROMPT)) return;
      restoredDrafts = latest.current;
      window.location.replace(event.oldURL);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [dirty]);

  const run = async (at: string, work: () => Promise<void>) => {
    setBusy(at);
    setError(null);
    setSaved(null);
    try {
      await work();
      setSaved(at);
    } catch (err) {
      setError({ at, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError({ at: 'photo', text: 'That file is not an image.' });
      setSaved(null);
      return;
    }
    await run('photo', async () => uploadAvatar(await prepareAvatar(file)));
  };

  const saveUsername = (event: FormEvent) => {
    event.preventDefault();
    if (!usernameChanged || problem || busy) return;
    void run('username', async () => {
      await changeUsername(username);
      setUsernameDraft(null);
    });
  };

  const savePassword = (event: FormEvent) => {
    event.preventDefault();
    if (!currentPw || newPw.length < 8 || busy) return;
    void run('password', async () => {
      await changePassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
    });
  };

  return (
    <div className="acct-settings">
      <section className="acct-card" aria-labelledby="acct-profile-title">
        <h3 id="acct-profile-title">Public profile</h3>
        <p className="acct-hint">Your username is the credit shown on routes you publish.</p>

        <div className="acct-photo">
          <Avatar url={user.avatarUrl} username={user.username} size={64} />
          <div className="acct-photo-actions">
            <button type="button" className="btn btn-light btn-sm" disabled={busy === 'photo'} onClick={() => fileRef.current?.click()}>
              {busy === 'photo' ? 'Uploading…' : user.avatarUrl ? 'Change photo' : 'Add photo'}
            </button>
            {user.avatarUrl && (
              <button
                type="button"
                className="profile-link"
                disabled={busy === 'photo'}
                onClick={() => void run('photo', removeAvatar)}
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void pickPhoto(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        {error?.at === 'photo' && (
          <p className="review-error" role="alert">
            {error.text}
          </p>
        )}
        {saved === 'photo' && (
          <p className="acct-ok" role="status">
            <CheckIcon size={12} /> Photo updated.
          </p>
        )}

        <form className="acct-form" onSubmit={saveUsername} noValidate>
          <label className="field" htmlFor="acct-username">
            Username
          </label>
          <input
            id="acct-username"
            className="acct-input"
            type="text"
            autoComplete="username"
            value={username}
            aria-invalid={problem ? true : undefined}
            aria-describedby="acct-username-help"
            onChange={(event) => {
              setUsernameDraft(event.target.value);
              if (saved === 'username') setSaved(null);
            }}
          />
          <p id="acct-username-help" className={`acct-hint${problem ? ' bad' : ''}`}>
            {problem ?? '3–24 letters, numbers, dots, dashes or underscores. Renaming also updates the credit on your published routes.'}
          </p>
          <div className="acct-form-actions">
            <button type="submit" className="btn btn-dark btn-sm" disabled={!usernameChanged || !!problem || busy === 'username'}>
              {busy === 'username' ? 'Saving…' : 'Save username'}
            </button>
            {saved === 'username' && (
              <span className="acct-ok" role="status">
                <CheckIcon size={12} /> Username updated.
              </span>
            )}
          </div>
          {error?.at === 'username' && (
            <p className="review-error" role="alert">
              {error.text}
            </p>
          )}
        </form>
      </section>

      <section className="acct-card" aria-labelledby="acct-signin-title">
        <h3 id="acct-signin-title">Sign-in</h3>
        <dl className="acct-rows">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Signed in with</dt>
            <dd>
              {methods.map((label) => (
                <span key={label} className="acct-status">
                  <CheckIcon size={12} /> {label}
                </span>
              ))}
            </dd>
          </div>
        </dl>

        {hasPassword ? (
          <form className="acct-form" onSubmit={savePassword} noValidate>
            <label className="field" htmlFor="acct-current-pw">
              Current password
            </label>
            <input
              id="acct-current-pw"
              className="acct-input"
              type="password"
              autoComplete="current-password"
              value={currentPw}
              onChange={(event) => setCurrentPw(event.target.value)}
            />
            <label className="field" htmlFor="acct-new-pw">
              New password
            </label>
            <input
              id="acct-new-pw"
              className="acct-input"
              type="password"
              autoComplete="new-password"
              value={newPw}
              aria-invalid={newPwShort ? true : undefined}
              aria-describedby="acct-new-pw-help"
              onChange={(event) => setNewPw(event.target.value)}
            />
            <p id="acct-new-pw-help" className={`acct-hint${newPwShort ? ' bad' : ''}`}>
              {newPwShort ? 'Use 8 characters or more.' : '8 characters or more. Other devices are signed out when it changes.'}
            </p>
            <div className="acct-form-actions">
              <button
                type="submit"
                className="btn btn-dark btn-sm"
                disabled={!currentPw || newPw.length < 8 || busy === 'password'}
              >
                {busy === 'password' ? 'Changing…' : 'Change password'}
              </button>
              {saved === 'password' && (
                <span className="acct-ok" role="status">
                  <CheckIcon size={12} /> Password changed.
                </span>
              )}
            </div>
            {error?.at === 'password' && (
              <p className="review-error" role="alert">
                {error.text}
              </p>
            )}
          </form>
        ) : (
          <p className="acct-hint">Your Google account handles your password, so there is nothing to set here.</p>
        )}
      </section>

      <section className="acct-card acct-danger" aria-labelledby="acct-delete-title">
        <h3 id="acct-delete-title">Delete account</h3>
        <p className="acct-hint">
          Removes your profile and photo for good. Routes you published stay in the open archive.
        </p>
        <button type="button" className="btn btn-light btn-sm acct-delete-open" onClick={() => setDeleteOpen(true)}>
          Delete account…
        </button>
      </section>

      {deleteOpen && <DeleteAccountDialog user={user} onClose={() => setDeleteOpen(false)} />}
    </div>
  );
}
