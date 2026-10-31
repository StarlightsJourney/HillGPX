import { useState, type ReactNode } from 'react';
import { StarIcon } from './icons';

const RATING_WORDS = ['', 'Not worth it', 'Meh', 'Solid', 'Great session', 'Must do'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function Stars({ value, size = 10 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <StarIcon key={i} size={size} filled={i <= Math.round(value)} />)}
    </span>
  );
}

interface ReviewCardProps {
  review: { rating: number; comment: string; author: string; createdAt: string; editedAt?: string | null };
  /** Replaces the "hillGPX contributor" line: "Your review", "Hidden by a moderator". */
  mark?: string;
  /** Leaves out the Report link when absent (your own review). */
  onReport?: () => void;
  /** Actions under the text. */
  children?: ReactNode;
}

/** One review, of a place or a route: who, stars, when, clamped text, then Report or your own actions. */
export function ReviewCard({ review, mark, onReport, children }: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const long = review.comment.length > 180;
  return (
    <article className="review-card">
      <header>
        <span className="review-avatar" aria-hidden="true">{review.author.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{review.author}</strong>
          <span>{mark ?? 'hillGPX contributor'}</span>
        </div>
      </header>
      <p className="review-meta">
        <Stars value={review.rating} /> · {formatDate(review.createdAt)}
        {review.editedAt && <> · edited {formatDate(review.editedAt)}</>}
      </p>
      {review.comment && <p className={`review-text${long && !expanded ? ' clamped' : ''}`}>{review.comment}</p>}
      {long && <button type="button" className="review-more" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'Show more'}</button>}
      {onReport && <button type="button" className="review-report" onClick={onReport}>Report</button>}
      {children}
    </article>
  );
}

/** The 1 to 5 star radio group of every review form. */
export function StarPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="rate-stars" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
          className={`rate-star${star <= shown ? ' on' : ''}`}
          onMouseEnter={() => setHover(star)}
          onClick={() => onChange(star)}
        >
          <StarIcon size={26} filled={star <= shown} />
        </button>
      ))}
      <span className="rate-word">{RATING_WORDS[shown]}</span>
    </div>
  );
}
