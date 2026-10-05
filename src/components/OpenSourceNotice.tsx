import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { REPO_URL } from '../lib/contribute';
import { Modal } from './Modal';
import { CloseIcon, DownloadIcon, GitHubIcon, Mark, UploadIcon } from './icons';

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

interface Point {
  id: string;
  icon: ReactNode;
  title: string;
  detail: ReactNode;
}

const POINTS: Point[] = [
  {
    id: 'download',
    icon: <DownloadIcon size={22} />,
    title: 'Free GPX',
    detail: 'Every route can be downloaded to a watch, phone or bike computer, at no cost.',
  },
  {
    id: 'open',
    icon: <GitHubIcon size={20} />,
    title: 'Open code',
    detail: 'The code and the data are on GitHub, so anyone can see how it works or improve it.',
  },
  {
    id: 'community',
    icon: <UploadIcon size={22} />,
    title: 'Built by runners',
    detail: (
      <>
        The map grows from GPX files people share. You can also{' '}
        <a href={`${REPO_URL}/issues/new?template=feedback.yml`} target="_blank" rel="noreferrer">suggest a fix</a> or{' '}
        <a href={`${REPO_URL}/blob/HEAD/docs/COMMUNITY.md`} target="_blank" rel="noreferrer">help with costs</a>.
      </>
    ),
  },
];

/**
 * Three short tiles; hovering, focusing or tapping one shows its line in the
 * panel underneath, which keeps one height so nothing below moves.
 */
function Points() {
  const [active, setActive] = useState(POINTS[0].id);
  const current = POINTS.find((point) => point.id === active) ?? POINTS[0];
  return (
    <div className="oss-points">
      <div className="oss-point-tiles" role="tablist" aria-label="How it works">
        {POINTS.map((point) => (
          <button
            key={point.id}
            type="button"
            role="tab"
            aria-selected={point.id === active}
            aria-controls="oss-point-detail"
            className={`oss-point${point.id === active ? ' on' : ''}`}
            onMouseEnter={() => setActive(point.id)}
            onFocus={() => setActive(point.id)}
            onClick={() => setActive(point.id)}
          >
            <span className="oss-point-icon" aria-hidden="true">{point.icon}</span>
            <strong>{point.title}</strong>
          </button>
        ))}
      </div>
      <p id="oss-point-detail" className="oss-point-detail" role="tabpanel" key={current.id}>
        {current.detail}
      </p>
    </div>
  );
}

/** Why it exists, in the founder's words: the problem, the fix, the hope. */
function CreatorNote() {
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <figure className="oss-creator">
      {photoFailed ? (
        <span className="oss-creator-photo initial" aria-hidden="true">M</span>
      ) : (
        <img className="oss-creator-photo" src={CREATOR.photo} alt="" width={52} height={52} loading="lazy" onError={() => setPhotoFailed(true)} />
      )}
      <div className="oss-creator-body">
        <blockquote>
          GPX files for good climbs are scattered across watches, forums and paywalls. hillGPX puts them on one open map, free to
          download. I hope every runner adds theirs.
        </blockquote>
        <figcaption>
          <a href={CREATOR.url} target="_blank" rel="noreferrer">{CREATOR.name}</a>
        </figcaption>
      </div>
    </figure>
  );
}

/** What "free and open source" means here, kept short and plain. */
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
          <Mark size={40} />
          <div>
            <h3>Free and open source</h3>
            <p className="oss-lead">hillGPX is free to use, and its code and data are public under the MIT licence.</p>
          </div>
        </header>
        <Points />
        <CreatorNote />
      </div>
    </Modal>
  );
}

/**
 * The "Free and open source" pill that opens the dialog, on every page:
 * bottom centre on the landing page, on the map itself (bottom left) on the
 * map page, and bottom left of the window elsewhere. Away from the landing
 * page it hides on phones, where the bottom belongs to the map toggle and the
 * venue bar.
 */
export function OpenSourceBadge({ placement }: { placement: 'landing' | 'corner' | 'on-map' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`oss-badge${placement === 'landing' ? '' : ` ${placement}`}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Mark size={18} />
        Free and open source
      </button>
      {open && <OpenSourceDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * First visit, once per browser session: a small centred card modelled on
 * Airbnb's "one price, all fees included" pop-up. The brand mark, one
 * sentence, one "Got it". "How it works" opens the full dialog.
 *
 * Shown on the landing page only: venue pages open in new tabs, which do not
 * share this tab's session, so the card would greet people again on every
 * place they opened. The badge covers every other page.
 */
export function OpenSourceNotice() {
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
      {details && <OpenSourceDialog onClose={() => setDetails(false)} />}
    </>
  );
}
