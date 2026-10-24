import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { deleteAccount, type AuthUser } from '../lib/auth';
import { errorText } from '../lib/api';
import { lockPageScroll } from '../lib/dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirmation for deleting the account. It is a separate dialog from `Modal`
 * because this one needs focus kept inside while it is open and starts on
 * Cancel, so a stray Enter never deletes anything. Deleting needs the username
 * typed out (and the password for password accounts).
 */
export function DeleteAccountDialog({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const titleId = useId();
  const descId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPassword = user.providers.includes('email');
  const ready = typed.trim() === user.username && (!hasPassword || password.length > 0);

  // The latest close handler without re-running the focus setup on every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockPageScroll();
    cancelRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
      previous?.focus?.();
    };
  }, []);

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !cardRef.current) return;
    const items = [...cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-root" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div
        ref={cardRef}
        className="acct-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={trapTab}
      >
        <form onSubmit={(event) => void submit(event)}>
          <h2 id={titleId}>Delete your account?</h2>
          <div id={descId} className="acct-dialog-copy">
            <p>This cannot be undone. Here is what happens:</p>
            <ul>
              <li>Your profile, username and photo are deleted.</li>
              <li>
                Routes, photos and reviews you already published stay in the open archive, still credited to your
                name, but you can no longer edit or delete them.
              </li>
            </ul>
            <p>
              To take a route down first, remove it from{' '}
              <a href="#uploads" onClick={onClose}>
                My uploads
              </a>
              .
            </p>
          </div>

          <label className="field">
            Type <strong className="acct-confirm-name">{user.username}</strong> to confirm
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          {hasPassword && (
            <label className="field">
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="review-error" role="alert">
              {error}
            </p>
          )}

          <div className="acct-dialog-actions">
            <button ref={cancelRef} type="button" className="btn btn-light" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn acct-delete-confirm" disabled={!ready || busy}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
