import { useState } from 'react';
import { REPO_URL } from '../lib/contribute';
import { Modal } from './Modal';
import { CloseIcon, GitHubIcon } from './icons';

const SEEN_KEY = 'hillgpx:openSourceNoticeSeen';

function seenThisSession(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode: the pill just shows again next time.
  }
}

/** What "open source" means here and how to help, in plain words. */
export function OpenSourceDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Free and open source"
      onClose={onClose}
      footer={
        <>
          <a className="btn btn-light" href={`${REPO_URL}/blob/HEAD/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
            How to help
          </a>
          <a className="btn btn-dark" href={REPO_URL} target="_blank" rel="noreferrer">
            <GitHubIcon size={16} />
            View on GitHub
          </a>
        </>
      }
    >
      <div className="oss-dialog">
        <p>
          hillGPX is built by volunteers and costs nothing to use. There are no ads and no accounts. The code and the map
          data are public on GitHub under the MIT licence.
        </p>
        <h3>Ways to help</h3>
        <ol>
          <li>
            <strong>Add data.</strong> Share a GPX of a route you know, add a missing hill, or send a photo.
          </li>
          <li>
            <strong>Make it easier to use.</strong> Tell us what was confusing, or suggest a better layout.
          </li>
          <li>
            <strong>Help with costs.</strong> A small donation, or telling your running group about it.
          </li>
        </ol>
      </div>
    </Modal>
  );
}

/**
 * A small pill on first visit, like Airbnb's "Prices include all fees": one
 * fact worth knowing up front, a tap away from the details. Shown once per
 * browser session.
 */
export function OpenSourceNotice({ raised = false }: { raised?: boolean }) {
  const [visible, setVisible] = useState(() => !seenThisSession());
  const [open, setOpen] = useState(false);
  if (!visible && !open) return null;

  const dismiss = () => {
    markSeen();
    setVisible(false);
  };

  return (
    <>
      {visible && (
        <div className={`oss-pill${raised ? ' raised' : ''}`} role="status">
          <button
            type="button"
            className="oss-pill-main"
            onClick={() => {
              dismiss();
              setOpen(true);
            }}
          >
            <GitHubIcon size={16} />
            <span>hillGPX is free and open source</span>
          </button>
          <button type="button" className="oss-pill-close" onClick={dismiss} aria-label="Dismiss">
            <CloseIcon size={10} />
          </button>
        </div>
      )}
      {open && <OpenSourceDialog onClose={() => setOpen(false)} />}
    </>
  );
}
