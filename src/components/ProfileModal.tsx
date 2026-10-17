import { useRef, useState } from 'react';
import { API_BASE } from '../lib/api';
import {
  changePassword,
  deleteAccount,
  removeAvatar,
  updateProfile,
  uploadAvatar,
  useAuthUser,
} from '../lib/auth';
import { Modal } from './Modal';

/** Centre-crop to a square and resize to 256 px JPEG — small enough for any use. */
async function prepareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas
    .getContext('2d')
    ?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))), 'image/jpeg', 0.85),
  );
}

function Avatar({ url, username, size = 72 }: { url: string | null; username: string; size?: number }) {
  return url ? (
    <img className="profile-avatar" src={`${API_BASE}${url}`} alt="" width={size} height={size} />
  ) : (
    <span className="profile-avatar placeholder" style={{ width: size, height: size }}>
      {username.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The signed-in account sheet: photo, username and email, password, and the
 * delete zone. Sections save independently; errors show where they happened.
 */
export function ProfileForm({ onClose }: { onClose?: () => void }) {
  const user = useAuthUser();
  const fileRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [deletePw, setDeletePw] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ at: string; text: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!user) return null;
  const hasPassword = user.providers.includes('password');

  const profileDirty = username.trim() !== user.username || email.trim().toLowerCase() !== user.email;

  const run = async (at: string, work: () => Promise<void>) => {
    setBusy(at);
    setError(null);
    setSaved(null);
    try {
      await work();
      setSaved(at);
    } catch (err) {
      setError({ at, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError({ at: 'photo', text: 'That file is not an image.' });
      return;
    }
    await run('photo', async () => uploadAvatar(await prepareAvatar(file)));
  };

  return (
    <div className="profile-form">
        <section className="profile-section">
          <div className="profile-photo-row">
            <Avatar url={user.avatarUrl} username={user.username} />
            <div>
              <h3>Profile photo</h3>
              <div className="profile-photo-actions">
                <button type="button" className="btn btn-light btn-sm" disabled={busy === 'photo'} onClick={() => fileRef.current?.click()}>
                  {user.avatarUrl ? 'Change photo' : 'Add photo'}
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
          {error?.at === 'photo' && <p className="review-error">{error.text}</p>}
          {saved === 'photo' && <p className="profile-ok">Photo updated.</p>}
        </section>

        <section className="profile-section">
          <h3>Profile</h3>
          <label className="field">
            Username
            <input type="text" maxLength={24} value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-dark btn-sm profile-save"
            disabled={busy === 'profile' || !profileDirty || username.trim().length < 3 || !/\S+@\S+\.\S+/.test(email.trim())}
            onClick={() =>
              void run('profile', () => updateProfile({ username: username.trim(), email: email.trim() }))
            }
          >
            {busy === 'profile' ? 'Saving…' : 'Save changes'}
          </button>
          {error?.at === 'profile' && <p className="review-error">{error.text}</p>}
          {saved === 'profile' && <p className="profile-ok">Saved.</p>}
        </section>

        <section className="profile-section">
          <h3>Password</h3>
          {hasPassword ? (
            <>
              <label className="field">
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                />
              </label>
              <label className="field">
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="8 characters or more"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-dark btn-sm profile-save"
                disabled={busy === 'password' || !currentPw || newPw.length < 8}
                onClick={() =>
                  void run('password', async () => {
                    await changePassword(currentPw, newPw);
                    setCurrentPw('');
                    setNewPw('');
                  })
                }
              >
                {busy === 'password' ? 'Changing…' : 'Change password'}
              </button>
              {error?.at === 'password' && <p className="review-error">{error.text}</p>}
              {saved === 'password' && <p className="profile-ok">Password changed. Other devices were signed out.</p>}
            </>
          ) : (
            <p className="profile-note">You sign in with Google — there is no password to change.</p>
          )}
        </section>

        <section className="profile-section danger">
          <h3>Delete account</h3>
          {!confirmDelete ? (
            <button type="button" className="profile-link danger" onClick={() => setConfirmDelete(true)}>
              Delete my account
            </button>
          ) : (
            <div className="profile-delete">
              <p className="profile-note">
                This removes your account and photo for good. Routes, photos and reviews you already published stay
                in the open archive — they were shared under a public licence.
              </p>
              {hasPassword && (
                <label className="field">
                  Password to confirm
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                  />
                </label>
              )}
              <div className="profile-photo-actions">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy === 'delete' || (hasPassword && !deletePw)}
                  onClick={() =>
                    void run('delete', async () => {
                      await deleteAccount(deletePw);
                      onClose?.();
                    })
                  }
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button type="button" className="profile-link" onClick={() => setConfirmDelete(false)}>
                  Keep my account
                </button>
              </div>
              {error?.at === 'delete' && <p className="review-error">{error.text}</p>}
            </div>
          )}
        </section>
      </div>
  );
}

/** The same sheet as a modal, for anywhere a dialog still fits better. */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Account" onClose={onClose} wide>
      <ProfileForm onClose={onClose} />
    </Modal>
  );
}
