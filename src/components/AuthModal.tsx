import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, finishPasswordReset, logIn, logInWithGoogle, resendConfirmation, resetPasswordForEmail, signUp } from '../lib/auth';
import { ApiError, errorText } from '../lib/api';
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
 * handle shown on contributions); logging in takes the email address.
 * Google sign-in renders the official button when VITE_GOOGLE_CLIENT_ID is
 * set — without it the divider and button stay hidden.
 */
export function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [resent, setResent] = useState<'no' | 'busy' | 'yes'>('no');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
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
              .catch((err: unknown) => setError(errorText(err)))
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
    setUnconfirmed(false);
    try {
      if (mode === 'signup') {
        if (await signUp(username, email, password)) {
          setConfirmEmail(email.trim());
          return;
        }
      } else await logIn(identifier, password);
      onClose();
    } catch (err) {
      setError(errorText(err));
      // 403 from logIn means "confirm your email first" — offer a resend.
      setUnconfirmed(err instanceof ApiError && err.status === 403);
    } finally {
      setBusy(false);
    }
  };

  const resendFor = async (id: string) => {
    setResent('busy');
    setError(null);
    try {
      await resendConfirmation(id);
      setResent('yes');
    } catch (err) {
      setError(errorText(err));
      setResent('no');
    }
  };

  const sendReset = async () => {
    setBusy(true);
    setError(null);
    try {
      await resetPasswordForEmail(forgotId);
      setForgotSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    mode === 'signup'
      ? username.trim().length >= 3 &&
        /\S+@\S+\.\S+/.test(email.trim()) &&
        password.length >= 8 &&
        confirmPassword === password
      : /\S+@\S+\.\S+/.test(identifier.trim()) && password.length > 0;

  if (confirmEmail) {
    return (
      <Modal
        title="Check your inbox"
        onClose={onClose}
        footer={
          <button
            type="button"
            className="btn btn-dark"
            onClick={() => {
              setConfirmEmail('');
              setMode('login');
              setPassword('');
              setConfirmPassword('');
              setError(null);
            }}
          >
            Back to log in
          </button>
        }
      >
        <p className="profile-note">
          We sent a confirmation link to <strong>{confirmEmail}</strong>. Open it to activate your account, then log
          in.
        </p>
        <p className="profile-note">
          Didn&apos;t arrive? Check your spam folder, or{' '}
          <button type="button" className="profile-link" disabled={resent !== 'no'} onClick={() => void resendFor(confirmEmail)}>
            {resent === 'busy' ? 'Sending…' : 'send it again'}
          </button>
          .
        </p>
        {resent === 'yes' && <p className="profile-ok">Sent — give it a minute.</p>}
        {error && <p className="review-error">{error}</p>}
      </Modal>
    );
  }

  if (forgot) {
    return (
      <Modal
        title="Reset your password"
        onClose={onClose}
        footer={
          forgotSent ? (
            <button
              type="button"
              className="btn btn-dark"
              onClick={() => {
                setForgot(false);
                setForgotSent(false);
                setError(null);
              }}
            >
              Back to log in
            </button>
          ) : (
            <button type="button" className="btn btn-dark" disabled={busy || !/\S+@\S+\.\S+/.test(forgotId.trim())} onClick={() => void sendReset()}>
              {busy ? 'Sending…' : 'Email me a reset link'}
            </button>
          )
        }
      >
        {forgotSent ? (
          <>
            <p className="profile-note">
              If an account exists for <strong>{forgotId.trim()}</strong>, a reset link is on its way to its email.
              Open it and choose a new password — the link brings you straight back here.
            </p>
            {error && <p className="review-error">{error}</p>}
          </>
        ) : (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && /\S+@\S+\.\S+/.test(forgotId.trim())) void sendReset();
            }}
          >
            <label className="field">
              Email address
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={forgotId}
                onChange={(event) => setForgotId(event.target.value)}
              />
            </label>
            <p className="profile-note">The reset link goes to the email on the account.</p>
            {error && <p className="review-error">{error}</p>}
          </form>
        )}
      </Modal>
    );
  }

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
            <label className="field">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Same password again"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {confirmPassword && confirmPassword !== password && (
              <p className="review-error">Passwords do not match.</p>
            )}
          </>
        ) : (
          <>
            <label className="field">
              Email address
              <input
                type="email"
                autoComplete="email"
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
            <button
              type="button"
              className="profile-link auth-forgot"
              onClick={() => {
                setForgotId(identifier.trim());
                setForgot(true);
                setError(null);
                setUnconfirmed(false);
              }}
            >
              Forgot password?
            </button>
          </>
        )}
        {error && <p className="review-error">{error}</p>}
        {unconfirmed && (
          <p className="profile-note">
            <button type="button" className="profile-link" disabled={resent !== 'no'} onClick={() => void resendFor(identifier)}>
              {resent === 'busy' ? 'Sending…' : resent === 'yes' ? 'Sent — check your inbox' : 'Resend the confirmation email'}
            </button>
          </p>
        )}
      </form>
    </Modal>
  );
}

/**
 * Where a reset-password email lands: the link opens a recovery session
 * (usePasswordRecovery), so this only collects the new password — the
 * visitor is already signed in when it closes.
 */
export function SetPasswordModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = password.length >= 8 && confirm === password;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await finishPasswordReset(password);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Choose a new password"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-dark" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Set new password'}
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
        <p className="profile-note">Your reset link already signed you in — pick a new password and you're done.</p>
        <label className="field">
          New password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="8 characters or more"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="field">
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Same password again"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        {confirm && confirm !== password && <p className="review-error">Passwords do not match.</p>}
        {error && <p className="review-error">{error}</p>}
      </form>
    </Modal>
  );
}
