import { useEffect, useState, type FormEvent } from 'react';
import { errorText } from '../lib/api';
import { changePassword, logOut, type AuthUser } from '../lib/auth';
import {
  connectGoogleHealth,
  disconnectGoogleHealth,
  googleHealthStatus,
  type GoogleHealthStatus,
} from '../lib/googleHealth';
import { CheckIcon, ExternalLinkIcon } from './icons';

/** Settings › Account: how you sign in, and deleting the account. */
export function SettingsAccount({ user, onDelete }: { user: AuthUser; onDelete: () => void }) {
  const hasGoogle = user.providers.includes('google');
  const hasPassword = user.providers.includes('email');

  return (
    <>
      <section className="ac-card" aria-labelledby="ac-signin-title">
        <h3 id="ac-signin-title">Sign-in</h3>
        <dl className="ac-kv">
          <div>
            <dt>Email</dt>
            <dd>
              {user.email}
              <small>Never shown publicly.</small>
            </dd>
          </div>
          {hasGoogle && (
            <div>
              <dt>Google</dt>
              <dd>
                <span className="ac-badge ok">
                  <CheckIcon size={12} /> Connected
                </span>
                <a className="ac-link" href="https://myaccount.google.com/" target="_blank" rel="noreferrer">
                  Manage Google Account <ExternalLinkIcon size={14} />
                </a>
              </dd>
            </div>
          )}
          {hasPassword && (
            <div>
              <dt>Password</dt>
              <dd>Email and password</dd>
            </div>
          )}
        </dl>
        {hasGoogle && !hasPassword && <p className="ac-help">Google is your only sign-in method, so it can't be disconnected.</p>}
        {hasPassword && <PasswordForm />}
        <button type="button" className="ac-btn soft" onClick={() => void logOut()}>
          Log out of this device
        </button>
      </section>

      <GoogleHealthCard />

      <section className="ac-card" aria-labelledby="ac-delete-title">
        <h3 id="ac-delete-title">Delete account</h3>
        <div className="ac-delete-grid">
          <div className="ac-delete-panel">
            <h4>Removed for good</h4>
            <ul>
              <li>Your profile, photo and username</li>
              <li>Saved routes and places</li>
              {hasGoogle && <li>The link to your Google sign-in</li>}
            </ul>
          </div>
          <div className="ac-delete-panel stays">
            <h4>Stays</h4>
            <ul>
              <li>
                Routes, photos and reviews you published, still credited to <strong>@{user.username}</strong> as published. You can no longer
                edit or delete them.
              </li>
            </ul>
          </div>
        </div>
        <button type="button" className="ac-btn danger-soft" aria-haspopup="dialog" onClick={onDelete}>
          Delete account…
        </button>
      </section>
    </>
  );
}

/** The Google Health link behind "pull a workout" in the import dialog. */
function GoogleHealthCard() {
  const [status, setStatus] = useState<GoogleHealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    googleHealthStatus()
      .then((next) => live && setStatus(next))
      .catch((caught) => live && setError(errorText(caught)));
    return () => {
      live = false;
    };
  }, []);

  const unlink = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnectGoogleHealth();
      setStatus({ connected: false, connectedAt: null, hasLocation: false });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectGoogleHealth();
      // Re-read the granted scopes — a partial consent shows the warning.
      setStatus(await googleHealthStatus());
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ac-card" aria-labelledby="ac-apps-title">
      <h3 id="ac-apps-title">Connected apps</h3>
      <dl className="ac-kv">
        <div>
          <dt>Google Health</dt>
          <dd>
            {status?.connected && (
              <span className="ac-badge ok">
                <CheckIcon size={12} /> Linked
              </span>
            )}
            <small>
              {status?.connected
                ? `Pull workouts from Fitbit, Pixel Watch and synced watches in the Add a GPX dialog.${
                    status.hasLocation ? '' : ' Location access was refused, so GPS tracks cannot be exported; relink and allow it.'
                  }`
                : 'Link it to pull GPS workouts from Fitbit, Pixel Watch and synced watches into the Add a GPX dialog.'}
            </small>
          </dd>
        </div>
      </dl>
      {status?.connected ? (
        <button type="button" className="ac-btn soft" disabled={busy} onClick={() => void unlink()}>
          {busy ? 'Unlinking…' : 'Unlink Google Health'}
        </button>
      ) : (
        <button type="button" className="ac-btn ink" disabled={status === null || busy} onClick={() => void link()}>
          {busy ? 'Linking…' : 'Link Google Health'}
        </button>
      )}
      {error && (
        <p className="ac-field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Password accounts only: Google accounts have nothing to change here. */
function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const short = next.length > 0 && next.length < 8;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current || next.length < 8 || busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ac-subform" onSubmit={(event) => void submit(event)} noValidate>
      <label className="ac-label" htmlFor="ac-current-pw">
        Current password
      </label>
      <input id="ac-current-pw" className="ac-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label className="ac-label" htmlFor="ac-new-pw">
        New password
      </label>
      <input
        id="ac-new-pw"
        className="ac-input"
        type="password"
        autoComplete="new-password"
        value={next}
        aria-invalid={short ? true : undefined}
        aria-describedby="ac-new-pw-help"
        onChange={(e) => setNext(e.target.value)}
      />
      <p id="ac-new-pw-help" className={short ? 'ac-field-error' : 'ac-help'}>
        {short ? 'Use 8 characters or more.' : '8 characters or more. Other devices are signed out when it changes.'}
      </p>
      <div className="ac-actions">
        <button type="submit" className="ac-btn ink" disabled={!current || next.length < 8 || busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
        {done && (
          <span className="ac-ok" role="status">
            <CheckIcon size={12} /> Password changed.
          </span>
        )}
      </div>
      {error && (
        <p className="ac-field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
