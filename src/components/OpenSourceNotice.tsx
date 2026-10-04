import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { REPO_URL } from '../lib/contribute';
import { Modal } from './Modal';
import { CloseIcon, DownloadIcon, GitHubIcon, HeartIcon, Mark, UploadIcon } from './icons';

const SEEN_KEY = 'hillgpx:openSourceNoticeSeen';

const CREATOR = {
  name: 'Madrid Lim',
  url: 'https://starlightsjourney.github.io/madrid-lim/',
  // The portrait from the About section of the portfolio (640 × 642).
  photo: 'https://starlightsjourney.github.io/madrid-lim/assets/media/shoe.webp',
};

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
    // Private mode: the notice just shows again next time.
  }
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="oss-point">
      <span className="oss-point-icon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </li>
  );
}

function CreatorNote() {
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <figure className="oss-creator">
      {photoFailed ? (
        <span className="oss-creator-photo initial" aria-hidden="true">M</span>
      ) : (
        <img
          className="oss-creator-photo"
          src={CREATOR.photo}
          alt={`${CREATOR.name} holding a trail shoe, in a running vest and cap`}
          width={120}
          height={120}
          loading="lazy"
          onError={() => setPhotoFailed(true)}
        />
      )}
      <blockquote className="oss-creator-quote">
        <p>
          I study data science at NUS and run trail ultras. The GPX for a good climb is usually buried in someone's watch, a forum
          thread or behind a paywall. hillGPX is my attempt to put every route up every hill in one open place, a click away from
          your watch.
        </p>
      </blockquote>
      <figcaption>
        <strong>{CREATOR.name}</strong>
        <span>Built hillGPX</span>
        <a href={CREATOR.url} target="_blank" rel="noreferrer">More about me</a>
      </figcaption>
    </figure>
  );
}

/** What "free and open source" means here, as Airbnb lays out its explainer sheets: a mark, a promise, plain points. */
export function OpenSourceDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="How hillGPX works"
      onClose={onClose}
      footer={
        <>
          <a className="btn btn-light oss-foot-btn" href={`${REPO_URL}/blob/HEAD/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
            How to help
          </a>
          <a className="btn btn-dark oss-foot-btn" href={REPO_URL} target="_blank" rel="noreferrer">
            <GitHubIcon size={16} />
            View on GitHub
          </a>
        </>
      }
    >
      <div className="oss-dialog">
        <header className="oss-hero">
          <Mark size={56} />
          <h3>Free and open source</h3>
          <p className="oss-lead">No ads and no accounts. The code and data are public under the MIT licence.</p>
        </header>
        <ul className="oss-points">
          <Point icon={<DownloadIcon size={24} />} title="Every route is free to download">
            Take any GPX straight to your watch, phone or bike computer. No sign-up, no paywall.
          </Point>
          <Point icon={<UploadIcon size={24} />} title="Built from runners' own files">
            Share a GPX and it goes on the map for everyone, with the elevation your device recorded.
          </Point>
          <Point icon={<GitHubIcon size={22} />} title="Open code and data">
            Everything lives on GitHub. Anyone can check how it works, copy it or make it better.
          </Point>
          <Point icon={<HeartIcon size={22} />} title="Kept going by the people who use it">
            <a href={`${REPO_URL}/issues/new?template=feedback.yml`} target="_blank" rel="noreferrer">Suggest a fix</a>, add a missing
            hill, or <a href={`${REPO_URL}/blob/HEAD/docs/COMMUNITY.md`} target="_blank" rel="noreferrer">help with hosting costs</a>.
          </Point>
        </ul>
        <CreatorNote />
      </div>
    </Modal>
  );
}

/**
 * First visit, once per browser session: a small centred card modelled on
 * Airbnb's "one price, all fees included" pop-up. The brand mark, one
 * sentence, one "Got it". "How it works" opens the full dialog.
 *
 * With `badge`, a small "Free and open source" pill stays at the bottom of the
 * screen once the card is dismissed (the landing page), opening the same
 * dialog.
 */
export function OpenSourceNotice({ badge = false }: { badge?: boolean }) {
  const [visible, setVisible] = useState(() => !seenThisSession());
  const [details, setDetails] = useState(false);
  const titleId = useId();
  const okRef = useRef<HTMLButtonElement>(null);

  const dismiss = () => {
    markSeen();
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        markSeen();
        setVisible(false);
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    okRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [visible]);

  return (
    <>
      {visible &&
        createPortal(
          <div className="oss-intro-root" onMouseDown={(event) => event.target === event.currentTarget && dismiss()}>
            <div className="oss-intro" role="dialog" aria-modal="true" aria-labelledby={titleId}>
              <button type="button" className="oss-intro-close" onClick={dismiss} aria-label="Close">
                <CloseIcon size={12} />
              </button>
              <span className="oss-intro-mark">
                <Mark size={64} />
              </span>
              <p id={titleId} className="oss-intro-text">
                hillGPX is <em>free to use</em> and <em>open source</em>.
              </p>
              <button ref={okRef} type="button" className="btn btn-dark oss-intro-ok" onClick={dismiss}>
                Got it
              </button>
              <button
                type="button"
                className="oss-intro-more"
                onClick={() => {
                  dismiss();
                  setDetails(true);
                }}
              >
                How it works
              </button>
            </div>
          </div>,
          document.body,
        )}
      {badge && !visible && (
        <button type="button" className="oss-badge" onClick={() => setDetails(true)} aria-haspopup="dialog">
          <Mark size={18} />
          Free and open source
        </button>
      )}
      {details && <OpenSourceDialog onClose={() => setDetails(false)} />}
    </>
  );
}
