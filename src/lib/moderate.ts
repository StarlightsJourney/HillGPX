/**
 * Pre-publish screening for contribution text and photos.
 *
 * Every call goes to /api/moderate (functions/api/moderate.js), the Pages
 * function that holds the OpenAI key and asks omni-moderation-latest. This
 * is a courtesy check for honest contributors: it answers 'unknown' when the
 * endpoint is missing (vite dev, the GitHub Pages backup) or OpenAI is down,
 * and 'unknown' never blocks — the database's moderation_gate trigger asks
 * the same question inside the write transaction, which is the check nobody
 * can skip (supabase/migrations/20261101000000_ai_moderation.sql).
 *
 * The refusal sentences duplicate the trigger's: keep both in step.
 */
export type ModerationInput = { type: 'text'; text: string } | { type: 'image'; base64: string };

export const MODERATION_MESSAGES = {
  username: "That username isn't allowed — pick another.",
  comment: "That review can't be published — it was flagged by our automated checks.",
  routeName: "That route name can't be published — it was flagged by our automated checks.",
  photo: "That photo can't be published — it was flagged by our automated checks.",
  caption: "That caption can't be published — it was flagged by our automated checks.",
} as const;

export interface ModerationResult {
  /** 'unknown' means the service could not answer. Never blocks: the DB decides. */
  verdict: 'ok' | 'flagged' | 'unknown';
  /** Per-input flags in the same order, when the service answered. */
  flagged: boolean[] | null;
}

interface ModerateResponseBody {
  flagged?: boolean;
  results?: { flagged?: boolean }[];
}

export async function moderate(inputs: ModerationInput[]): Promise<ModerationResult> {
  if (inputs.length === 0) return { verdict: 'ok', flagged: [] };
  try {
    const response = await fetch('/api/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    });
    if (!response.ok) return { verdict: 'unknown', flagged: null };
    const data = (await response.json()) as ModerateResponseBody;
    if (typeof data.flagged !== 'boolean') return { verdict: 'unknown', flagged: null };
    return {
      verdict: data.flagged ? 'flagged' : 'ok',
      flagged: (data.results ?? []).map((result) => Boolean(result.flagged)),
    };
  } catch {
    return { verdict: 'unknown', flagged: null };
  }
}

export function moderateText(text: string): Promise<ModerationResult> {
  return moderate([{ type: 'text', text }]);
}

/** The photo as the service sees it: raw base64, no data-URL prefix. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.readAsDataURL(blob);
  });
}

export async function moderateImage(blob: Blob): Promise<ModerationResult> {
  try {
    return await moderate([{ type: 'image', base64: await blobToBase64(blob) }]);
  } catch {
    return { verdict: 'unknown', flagged: null };
  }
}

/**
 * The refusal sentence for the first flagged input, or null when nothing was
 * flagged. `messages[i]` is the sentence for inputs[i], matching the order
 * the trigger uses in the migration.
 */
export function refusalMessage(result: ModerationResult, messages: readonly string[]): string | null {
  if (result.verdict !== 'flagged') return null;
  const index = result.flagged?.findIndex(Boolean) ?? -1;
  return messages[index >= 0 ? index : 0] ?? messages[0] ?? MODERATION_MESSAGES.comment;
}
