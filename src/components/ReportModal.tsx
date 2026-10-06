import { useState } from 'react';
import { loadAuthor, saveAuthor, submitReport, type ReportKind, type ReportTarget } from '../lib/api';
import { Modal } from './Modal';

export function FlagIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 15V2m0 1h8.5l-1.6 3 1.6 3H3" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6.6 9.4a2.8 2.8 0 0 0 4 0l2.2-2.2a2.8 2.8 0 0 0-4-4l-.8.8" />
      <path d="M9.4 6.6a2.8 2.8 0 0 0-4 0L3.2 8.8a2.8 2.8 0 0 0 4 4l.8-.8" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

const KINDS: { value: ReportKind; label: string; hint: string }[] = [
  { value: 'wrong_details', label: 'Wrong details', hint: 'Height, name, location or type is off' },
  { value: 'hazard', label: 'Hazard', hint: 'Landslip, fallen tree, broken steps, wildlife' },
  { value: 'closed', label: 'Closed or no access', hint: 'Locked stairwell, closed trail, private land' },
  { value: 'photo', label: 'Photo problem', hint: 'Wrong place or unsuitable image' },
  { value: 'other', label: 'Something else', hint: '' },
];

/** For one photo or review: what makes it break the house rules. */
const CONTENT_KINDS: { value: ReportKind; label: string; hint: string }[] = [
  { value: 'photo', label: 'Wrong place or unclear', hint: 'Not this place, or not useful' },
  { value: 'abuse', label: 'Spam, rude or personal', hint: 'Adverts, insults, or details about a person' },
  { value: 'other', label: 'Something else', hint: '' },
];

/** Hints that read better for a route than the place-oriented defaults. */
const ROUTE_HINTS: Partial<Record<ReportKind, string>> = {
  wrong_details: 'Name, distance, EG or the track itself is off',
  closed: 'Closed trail, private land, path no longer there',
};

/** One small form for everything a visitor might want a maintainer to look at. */
export function ReportModal({ targetType, targetSlug, targetName, onClose }: { targetType: ReportTarget; targetSlug: string; targetName: string; onClose: () => void }) {
  const content = targetType === 'photo' || targetType === 'route_photo' || targetType === 'review';
  const kinds = content ? CONTENT_KINDS : KINDS;
  const [kind, setKind] = useState<ReportKind>(kinds[0].value);
  const [message, setMessage] = useState('');
  const [author] = useState(loadAuthor);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    saveAuthor(author);
    try {
      await submitReport({ targetType, targetSlug, kind, message, author });
      setSent(true);
    } catch (err) {
      setError(`Could not send the report: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={content ? `Report ${targetName}` : `Report an issue with ${targetName}`}
      onClose={onClose}
      footer={sent ? (
        <button type="button" className="btn btn-dark" onClick={onClose}>Done</button>
      ) : (
        <button type="button" className="btn btn-dark" disabled={busy || message.trim().length < 3} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
      )}
    >
      {sent ? (
        <p className="review-thanks">Thank you. A moderator will look at it; if several people report the same photo or review, it is hidden straight away.</p>
      ) : (
        <div className="report-form">
          <div className="report-kinds" role="radiogroup" aria-label="What is wrong">
            {kinds.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                className={`report-kind${kind === option.value ? ' on' : ''}`}
                onClick={() => setKind(option.value)}
              >
                <strong>{option.label}</strong>
                {option.hint && <span>{(targetType === 'route' && ROUTE_HINTS[option.value]) || option.hint}</span>}
              </button>
            ))}
          </div>
          <textarea
            className="review-comment"
            rows={3}
            maxLength={1000}
            placeholder={content ? 'What is wrong with it?' : 'What should be fixed? The more specific, the faster it gets done.'}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          {error && <p className="review-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
