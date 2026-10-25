import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { deleteAccount, type AuthUser } from '../lib/auth';
import { errorText } from '../lib/api';
import { lockPageScroll } from '../lib/dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Stage = 'confirm' | 'deleting' | 'done';

/**
 * Confirmation for deleting the account. A separate dialog from `Modal`
 * because it keeps focus inside while open and starts on Cancel, so a stray
 * Enter never deletes anything. The username must be typed exactly (and the
 * password for password accounts) before the button enables. Escape and Cancel
 * close it, except while the request is running. Afterwards it confirms the
 * deletion and offers the way back to the map.
 */
export function DeleteAccountDialog({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const titleId = useId();
  const descId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<Stage>('confirm');
  const [error, setError] = useState<string | null>(null);

  const hasPassword = user.providers.includes('email');
  const hasGoogle = user.providers.includes('google');
  const ready = isDeleteConfirmed(typed, user.username) && (!hasPassword || password.length > 0);

  const backToMap = () => {
    window.location.hash = '#map';
    onClose();
  };

  // The latest handlers without re-running the focus setup on every render.
  const closeRef = useRef(onClose);
  closeRef.current = stage === 'done' ? backToMap : onClose;
  const stageRef = useRef(stage);
  stageRef.current = stage;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockPageScroll();
    cancelRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && stageRef.current !== 'deleting') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (stage === 'done') doneRef.current?.focus();
  }, [stage]);

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
    if (!ready || stage !== 'confirm') return;
    setStage('deleting');
    setError(null);
    try {
      await deleteAccount(password, { stay: true });
      setStage('done');
    } catch (err) {
      setError(errorText(err));
      setStage('confirm');
    }
  };

  const busy = stage === 'deleting';

  return createPortal(
    <div className="modal-root" onMouseDown={(event) => event.target === event.currentTarget && !busy && closeRef.current()}>
      <div
        ref={cardRef}
        className="ac-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={trapTab}
      >
        {stage === 'done' ? (
          <div className="ac-dialog-done">
            <h2 id={titleId}>Account deleted</h2>
            <p id={descId}>Your account is deleted and you are signed out. Thanks for climbing with us.</p>
            <button ref={doneRef} type="button" className="ac-btn ink" onClick={backToMap}>
              Back to the map
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <h2 id={titleId}>Delete your account?</h2>
            <div id={descId} className="ac-dialog-copy">
              <p>This cannot be undone.</p>
              <p>
                <strong>Removed for good:</strong> your profile, photo and username, your saved routes and places
                {hasGoogle ? ' and the link to your Google sign-in' : ''}.
              </p>
              <p>
                <strong>Stays:</strong> the routes, photos and reviews you published remain in the open archive, still credited to @{user.username},
                but you can no longer edit or delete them. Delete a route from your profile first if you want it gone.
              </p>
            </div>

            <label className="ac-label" htmlFor="ac-confirm-name">
              Type <strong>{user.username}</strong> to confirm
            </label>
            <input
              id="ac-confirm-name"
              className="ac-input"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
            {hasPassword && (
              <>
                <label className="ac-label" htmlFor="ac-confirm-pw">
                  Password
                </label>
                <input
                  id="ac-confirm-pw"
                  className="ac-input"
                  type="password"
                  autoComplete="current-password"
                  disabled={busy}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </>
            )}
            {error && (
              <p className="ac-field-error" role="alert">
                {error}
              </p>
            )}

            <div className="ac-dialog-actions">
              <button ref={cancelRef} type="button" className="ac-btn soft" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="ac-btn danger" disabled={!ready || busy}>
                {busy ? (
                  <>
                    <span className="ac-spin" aria-hidden="true" /> Deleting…
                  </>
                ) : (
                  'Delete account'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The delete button enables only when the typed text matches the username exactly. */
export function isDeleteConfirmed(typed: string, username: string): boolean {
  return typed === username;
}
