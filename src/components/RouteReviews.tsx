import { useState } from 'react';
import { deleteRouteReview, editRouteReview, errorText, submitRouteReview, type MyRouteReview, type RouteReview } from '../lib/api';
import { useAuthUser, type AuthUser } from '../lib/auth';
import { requestReviewReport } from '../lib/contribute';
import type { RouteReviewsState } from '../lib/useRouteReviews';
import { AuthModal } from './AuthModal';
import { CreditChips } from './CreditChips';
import { Modal } from './Modal';
import { ReviewCard, StarPicker } from './ReviewCard';

const REVIEWS_SHOWN = 3;
const MAX_COMMENT = 1000;

/** Writing a new review, or changing yours (`editing`, filled in, with Cancel). */
function RouteReviewForm({ routeSlug, user, editing, onSaved, onCancel }: {
  routeSlug: string;
  user: AuthUser;
  editing?: MyRouteReview;
  onSaved: (review: RouteReview) => void;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState(editing?.rating ?? 0);
  const [comment, setComment] = useState(editing?.comment ?? '');
  const [anonymous, setAnonymous] = useState(editing ? editing.author !== user.username : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = rating > 0 && comment.trim().length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    const input = { rating, comment, author: anonymous ? '' : user.username };
    try {
      onSaved(editing ? await editRouteReview(editing.id, input) : await submitRouteReview({ routeSlug, ...input }));
    } catch (caught) {
      setError(`Could not ${editing ? 'save' : 'post'} your review: ${errorText(caught)}`);
      setBusy(false);
    }
  };

  return (
    <div className="review-form inline">
      <h3>{editing ? 'Edit your review' : 'Your review'}</h3>
      <StarPicker value={rating} onChange={setRating} />
      <textarea
        className="review-comment"
        aria-label="Your review"
        placeholder="Is the line easy to follow? Overgrown sections, shade, water"
        rows={3}
        value={comment}
        maxLength={MAX_COMMENT}
        onChange={(event) => setComment(event.target.value)}
      />
      <p className="review-count">{comment.length}/{MAX_COMMENT}</p>
      <CreditChips username={user.username} anonymous={anonymous} onChange={setAnonymous} />
      <div className="review-form-row">
        <button type="button" className="btn btn-dark" disabled={!ready || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : editing ? 'Save review' : 'Post review'}
        </button>
        {onCancel && <button type="button" className="btn btn-light" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
      {error && <p className="review-error" role="alert">{error}</p>}
    </div>
  );
}

/** "Your review" with Edit and Delete; a hidden one is shown to its author alone, with neither. */
function MyReview({ review, onEdit, onDeleted }: { review: MyRouteReview; onEdit: () => void; onDeleted: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (review.hidden) return <ReviewCard review={review} mark="Hidden by a moderator" />;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteRouteReview(review.id);
      onDeleted(review.id);
    } catch (caught) {
      setError(`Could not delete your review: ${errorText(caught)}`);
      setBusy(false);
    }
  };

  return (
    <ReviewCard review={review} mark="Your review">
      <div className="review-actions">
        {confirming ? (
          <>
            <span>Delete this review?</span>
            <button type="button" className="review-more" disabled={busy} onClick={() => void remove()}>Yes, delete</button>
            <button type="button" className="review-more" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          </>
        ) : (
          <>
            <button type="button" className="review-more" onClick={onEdit}>Edit</button>
            <button type="button" className="review-more" onClick={() => setConfirming(true)}>Delete</button>
          </>
        )}
      </div>
      {error && <p className="review-error" role="alert">{error}</p>}
    </ReviewCard>
  );
}

/** The reviews section of the route panel's "More details". The panel owns the loading, for its rating line. */
export function RouteReviews({ routeSlug, state }: { routeSlug: string; state: RouteReviewsState }) {
  const user = useAuthUser();
  const [editing, setEditing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { reviews, error, mine, mineKnown, retry, onSaved, onDeleted } = state;
  const others = (reviews ?? []).filter((review) => review.id !== mine?.id);
  // The visitor's own review, hidden or not, is one of the cards shown.
  const othersShown = others.slice(0, mine ? REVIEWS_SHOWN - 1 : REVIEWS_SHOWN);

  return (
    <div className="route-reviews">
      <strong>Reviews</strong>
      {error && (
        <div className="review-load-error">
          <p className="review-error" role="alert">Could not load reviews: {error}</p>
          <button type="button" className="review-more" onClick={retry}>Try again</button>
        </div>
      )}
      {reviews && (
        <>
          {mine && user && (editing
            ? <RouteReviewForm routeSlug={routeSlug} user={user} editing={mine} onSaved={(review) => { onSaved(review); setEditing(false); }} onCancel={() => setEditing(false)} />
            : <MyReview key={mine.id} review={mine} onEdit={() => setEditing(true)} onDeleted={onDeleted} />)}
          {othersShown.map((review) => <ReviewCard key={review.id} review={review} onReport={() => requestReviewReport('route_review', review)} />)}
          {others.length > othersShown.length && (
            <button type="button" className="reviews-all" onClick={() => setShowAll(true)}>Show all {reviews.length} reviews</button>
          )}
          {reviews.length === 0 && !mine && <p className="route-reviews-empty">No reviews yet.</p>}
          {user
            ? mineKnown && !mine && <RouteReviewForm key={routeSlug} routeSlug={routeSlug} user={user} onSaved={onSaved} />
            : <button type="button" className="reviews-all" onClick={() => setSigningIn(true)}>Log in to write a review</button>}
        </>
      )}
      {signingIn && <AuthModal onClose={() => setSigningIn(false)} />}
      {showAll && reviews && (
        <Modal title={`${reviews.length} reviews`} onClose={() => setShowAll(false)} wide>
          <div className="review-grid single">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} mark={review.id === mine?.id ? 'Your review' : undefined} onReport={review.id === mine?.id ? undefined : () => requestReviewReport('route_review', review)} />
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
