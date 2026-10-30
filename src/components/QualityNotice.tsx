import { describeFlag, type QualityFlag } from '../lib/routeQuality';

interface QualityNoticeProps {
  flags: QualityFlag[];
  /** What the key flags mean for this person, e.g. "Only you can see this until it passes." */
  heading?: string;
}

/**
 * Why a route is held, or what to know about it. Key flags read as a problem,
 * advisory ones as a note; the text carries the meaning, colour only adds to it.
 */
export function QualityNotice({ flags, heading }: QualityNoticeProps) {
  if (flags.length === 0) return null;
  const held = flags.some((f) => f.severity === 'key');
  return (
    <div className={`quality-notice${held ? ' held' : ''}`} role={held ? 'alert' : 'status'}>
      {heading && <strong>{heading}</strong>}
      <ul>
        {flags.map((f) => (
          <li key={`${f.id}-${f.at ?? ''}`}>{describeFlag(f)}</li>
        ))}
      </ul>
    </div>
  );
}

/** The small "Only you can see this" tag used on lists and the route panel. */
export function HeldBadge() {
  return <span className="held-badge">Only you can see this</span>;
}
