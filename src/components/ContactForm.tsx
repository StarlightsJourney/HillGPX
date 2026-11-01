import { useState } from 'react';
import { errorText, submitContact, type ContactKind } from '../lib/api';
import { useAuthUser } from '../lib/auth';
import { Modal } from './Modal';

const KINDS: { value: ContactKind; label: string; hint: string }[] = [
  { value: 'question', label: 'Question', hint: 'Anything you want to ask' },
  { value: 'feedback', label: 'Feedback', hint: 'What worked, what was confusing' },
  { value: 'removal', label: 'Removal request', hint: 'Take something down — name the page or route' },
  { value: 'other', label: 'Something else', hint: '' },
];

/**
 * The one form behind the Contact page and the account menu's Help and
 * feedback. Messages land in the moderators' report queue, so nothing here
 * is public; an email is only asked for when a reply is wanted.
 */
export function ContactForm({ onSent }: { onSent?: () => void }) {
  const [kind, setKind] = useState<ContactKind>('question');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const user = useAuthUser();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = replyTo.trim() === '' || /^\S+@\S+\.\S+$/.test(replyTo.trim());
  const ready = !busy && message.trim().length >= 3 && emailOk;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitContact({ kind, message, author: user?.username ?? '', replyTo });
      setSent(true);
    } catch (err) {
      setError(`Could not send: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="contact-form">
        <p className="review-thanks">
          Thank you — it is in the moderators' queue.{replyTo.trim() ? ' You left an email, so you will hear back there.' : ''}
        </p>
        {onSent && (
          <button type="button" className="btn btn-dark contact-send" onClick={onSent}>
            Done
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="report-form contact-form">
      <div className="report-kinds" role="radiogroup" aria-label="What is it about">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={kind === option.value}
            className={`report-kind${kind === option.value ? ' on' : ''}`}
            onClick={() => setKind(option.value)}
          >
            <strong>{option.label}</strong>
            {option.hint && <span>{option.hint}</span>}
          </button>
        ))}
      </div>
      <textarea
        className="review-comment"
        rows={4}
        maxLength={1000}
        placeholder="A link to the page, route or photo it is about helps."
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <label className="field">
        Email for a reply (optional)
        <input
          type="email"
          maxLength={160}
          placeholder="Only if you want an answer back"
          value={replyTo}
          onChange={(event) => setReplyTo(event.target.value)}
        />
      </label>
      {error && <p className="review-error">{error}</p>}
      <button type="button" className="btn btn-dark contact-send" disabled={!ready} onClick={() => void send()}>
        {busy ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

/** The same form as a dialog, so the account menu can open it over any page. */
export function ContactModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Help and feedback" onClose={onClose}>
      <ContactForm onSent={onClose} />
    </Modal>
  );
}
