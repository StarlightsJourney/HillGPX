import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { REPO_URL, openImportHere } from '../lib/contribute';
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
  /** One short line, shown under the tiles while the tile is hovered or focused. */
  detail: string;
  href: string;
  external?: boolean;
  /** Runs on click (closes the dialog, opens the upload where you are). */
  onClick?: (event: { preventDefault: () => void }) => void;
}

/**
 * Three tiles that go somewhere: browse routes, the code on GitHub, add a
 * GPX. Each has an arrow so it reads as a link, and its one-line description
 * shows underneath on hover or focus (the first one's by default).
 */
function Points({ onClose }: { onClose: () => void }) {
  const points: Point[] = [
    { id: 'download', icon: <DownloadIcon size={20} />, title: 'Free GPX', detail: 'Browse routes and download any of them to your watch or phone.', href: '#routes', onClick: () => onClose() },
    { id: 'open', icon: <GitHubIcon size={18} />, title: 'Open code', detail: 'Read, copy or improve the code and data on GitHub.', href: REPO_URL, external: true },
    {
      id: 'share',
      icon: <UploadIcon size={20} />,
      title: 'Add a GPX',
      detail: 'Share a route from your watch and it goes on the map for everyone.',
      href: '#import',
      onClick: (event) => {
        onClose();
        openImportHere(event);
      },
    },
  ];
  const [active, setActive] = useState(points[0].id);
  const current = points.find((point) => point.id === active) ?? points[0];
  return (
    <div className="oss-points">
      <nav className="oss-point-tiles" aria-label="Get started">
        {points.map((point) => (
          <a
            key={point.id}
            href={point.href}
            className={`oss-point${point.id === active ? ' on' : ''}`}
            onMouseEnter={() => setActive(point.id)}
            onFocus={() => setActive(point.id)}
            onClick={point.onClick}
            aria-describedby={point.id === active ? 'oss-point-detail' : undefined}
            {...(point.external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            <span className="oss-point-icon" aria-hidden="true">{point.icon}</span>
            <strong>{point.title}</strong>
            <span className="oss-point-arrow" aria-hidden="true">{point.external ? '↗' : '→'}</span>
          </a>
        ))}
      </nav>
      <p id="oss-point-detail" className="oss-point-detail" key={current.id}>
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
            <p className="oss-lead">Free to use. Open code and data, MIT licence.</p>
          </div>
        </header>
        <Points onClose={onClose} />
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
