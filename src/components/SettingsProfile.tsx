import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, errorText } from '../lib/api';
import { changeUsername, removeAvatar, uploadAvatar, type AuthUser } from '../lib/auth';
import { useMyRoutes } from '../lib/myRoutes';
import { takenMessage, USERNAME_MAX, usernameProblem } from '../lib/username';
import { Avatar, prepareAvatar } from './Avatar';
import { CheckIcon } from './icons';

interface Props {
  user: AuthUser;
  /** The unsaved username, or null when the field shows the saved one. */
  draft: string | null;
  onDraft: (value: string | null) => void;
}

/** Settings › Profile: photo and public username. */
export function SettingsProfile({ user, draft, onDraft }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { routes } = useMyRoutes();
  const value = draft ?? user.username;
  const trimmed = value.trim();
  const dirty = trimmed !== user.username;

  // Rule errors wait for the first blur or submit, so typing a name is never
  // scolded halfway; after that they follow the input and clear when it is valid.
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rule = usernameProblem(value);
  const problem = serverError ?? (touched ? rule : null);
  const sample = routes && routes.length > 0 ? routes[0].name : 'Your route';

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || saving) return;
    setTouched(true);
    if (rule) return;
    setSaving(true);
    setServerError(null);
    setSavedAs(null);
    try {
      await changeUsername(trimmed);
      onDraft(null);
      setTouched(false);
      setSavedAs(trimmed);
      setToast('Username updated');
    } catch (err) {
      setServerError(err instanceof ApiError && err.status === 409 ? takenMessage(trimmed) : errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    onDraft(null);
    setTouched(false);
    setServerError(null);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoMessage({ ok: false, text: 'That file is not an image.' });
      return;
    }
    await runPhoto(async () => uploadAvatar(await prepareAvatar(file)), 'Photo updated.');
  };

  const runPhoto = async (work: () => Promise<void>, done: string) => {
    setPhotoBusy(true);
    setPhotoMessage(null);
    try {
      await work();
      setPhotoMessage({ ok: true, text: done });
    } catch (err) {
      setPhotoMessage({ ok: false, text: errorText(err) });
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <>
      <form className="ac-card" onSubmit={(event) => void submit(event)} noValidate>
        <div className="ac-photo">
          <Avatar url={user.avatarUrl} username={user.username} size={72} />
          <div>
            <button type="button" className="ac-btn soft" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {photoBusy ? 'Uploading…' : 'Upload new photo'}
            </button>
            {user.avatarUrl && (
              <button type="button" className="ac-link" disabled={photoBusy} onClick={() => void runPhoto(removeAvatar, 'Photo removed.')}>
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
        {photoMessage && (
          <p className={photoMessage.ok ? 'ac-ok' : 'ac-field-error'} role={photoMessage.ok ? 'status' : 'alert'}>
            {photoMessage.ok && <CheckIcon size={12} />} {photoMessage.text}
          </p>
        )}

        <label className="ac-label" htmlFor="ac-username">
          Username
        </label>
        <div className={`ac-field${problem ? ' bad' : ''}`}>
          <span className="ac-at" aria-hidden="true">
            @
          </span>
          <input
            id="ac-username"
            type="text"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            aria-invalid={problem ? true : undefined}
            aria-describedby="ac-username-help ac-username-error"
            onChange={(event) => {
              onDraft(event.target.value);
              setServerError(null);
              setSavedAs(null);
            }}
            onBlur={() => setTouched(true)}
          />
          <span className="ac-count" aria-hidden="true">
            {value.length}/{USERNAME_MAX}
          </span>
        </div>
        <p id="ac-username-error" className="ac-field-error" role="alert">
          {problem}
        </p>
        <p id="ac-username-help" className="ac-help">
          3–24 letters, numbers, dots, dashes or underscores. It's the credit on every route you publish, so changing it updates them all.
        </p>
        <p className="ac-preview">
          Preview: <strong>{sample}</strong> · by @{trimmed || user.username}
        </p>
        {savedAs && !dirty && (
          <p className="ac-ok" role="status">
            <CheckIcon size={12} /> Saved. Your routes now credit @{savedAs}.
          </p>
        )}

        <div className="ac-savebar">
          <span className="ac-savebar-state" aria-live="polite">
            {saving ? (
              <>
                <span className="ac-spin" aria-hidden="true" /> Saving…
              </>
            ) : dirty ? (
              'Unsaved changes'
            ) : null}
          </span>
          <button type="button" className="ac-btn soft" disabled={!dirty || saving} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="ac-btn ink" disabled={!dirty || saving}>
            Save changes
          </button>
        </div>
      </form>
      {toast && (
        <div className="ac-toast" role="status">
          <CheckIcon size={14} /> {toast}
        </div>
      )}
    </>
  );
}
