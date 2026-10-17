import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, logIn, logInWithGoogle, signUp } from '../lib/auth';
import { Modal } from './Modal';

interface GoogleAccounts {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

let gisPromise: Promise<GoogleAccounts> | null = null;

/** Load Google Identity Services once, only when a client ID is configured. */
function loadGis(): Promise<GoogleAccounts> {
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in failed to load.')));
    script.onerror = () => reject(new Error('Google sign-in failed to load.'));
    document.head.appendChild(script);
  });
  gisPromise.catch(() => {
    gisPromise = null;
  });
  return gisPromise;
}

/**
 * The one "Log in or sign up" dialog. Email sign-up asks for a username (the
 * handle shown on contributions); logging in takes the email or the username.
 * Google sign-in renders the official button when VITE_GOOGLE_CLIENT_ID is
 * set — without it the divider and button stay hidden.
 */
export function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGis()
      .then((google) => {
        const el = googleRef.current;
        if (cancelled || !el) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: ({ credential }) => {
            setBusy(true);
            setError(null);
            void logInWithGoogle(credential)
              .then(() => onCloseRef.current())
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false));
          },
        });
        el.replaceChildren();
        google.accounts.id.renderButton(el, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: mode === 'signup' ? 'signup_with' : 'signin_with',
          width: Math.max(200, Math.min(400, el.offsetWidth || 320)),
        });
      })
      .catch(() => {
        // No script, no button: email sign-up still works.
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await signUp(username, email, password);
      else await logIn(identifier, password);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready =
    mode === 'signup'
      ? username.trim().length >= 3 && /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 8
      : identifier.trim().length > 0 && password.length > 0;

  return (
    <Modal
      title="Log in or sign up"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-dark" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      }
    >
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) void submit();
        }}
      >
        <div className="seg-tabs auth-tabs" role="tablist" aria-label="Log in or sign up">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'on' : ''}
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
          >
            Sign up
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'on' : ''}
            onClick={() => {
              setMode('login');
              setError(null);
            }}
          >
            Log in
          </button>
        </div>
        {GOOGLE_CLIENT_ID && (
          <>
            <div className="auth-google" ref={googleRef} />
            <div className="auth-divider" aria-hidden="true">
              <span>or</span>
            </div>
          </>
        )}
        {mode === 'signup' ? (
          <>
            <label className="field">
              Username
              <input
                type="text"
                autoComplete="username"
                maxLength={24}
                placeholder="e.g. ridge-runner"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                autoComplete="new-password"
                placeholder="8 characters or more"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              Email or username
              <input
                type="text"
                autoComplete="username"
                placeholder="you@example.com"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </>
        )}
        {error && <p className="review-error">{error}</p>}
      </form>
    </Modal>
  );
}
