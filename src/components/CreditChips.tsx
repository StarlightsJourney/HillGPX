import type { ReactNode } from 'react';

/**
 * The only credit a signed-in contributor can pick: their username or
 * anonymous. Signed-out visitors never see this — their shares go up
 * uncredited. The server clamps the stored credit to the same two choices
 * (see the stamp triggers in supabase/migrations/), so a rename can follow
 * every upload that carried the old name.
 */
export function CreditChips({ username, anonymous, onChange, children }: {
  username: string;
  anonymous: boolean;
  onChange: (anonymous: boolean) => void;
  /** Optional note rendered under the chips (e.g. what "anonymous" still keeps). */
  children?: ReactNode;
}) {
  return (
    <div className="field">
      <span>Credit</span>
      <div className="chip-row" role="radiogroup" aria-label="Credit">
        <button type="button" role="radio" aria-checked={!anonymous} className={`chip${anonymous ? '' : ' on'}`} onClick={() => onChange(false)}>
          {username}
        </button>
        <button type="button" role="radio" aria-checked={anonymous} className={`chip${anonymous ? ' on' : ''}`} onClick={() => onChange(true)}>
          Anonymous
        </button>
      </div>
      {children}
    </div>
  );
}
