/** Public usernames: the same rule the `profiles` table enforces. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

/** What is wrong with a username as typed, or null when it is fine. */
export function usernameProblem(value: string): string | null {
  const name = value.trim();
  if (name.length < USERNAME_MIN) return 'Use at least 3 characters.';
  if (name.length > USERNAME_MAX) return 'Use 24 characters or fewer.';
  if (!USERNAME_RE.test(name)) return 'Use only letters, numbers, dots, dashes or underscores.';
  return null;
}

/** The sentence for a rename the server refused because the name is in use. */
export function takenMessage(name: string): string {
  return `@${name.trim()} is already taken. Try another.`;
}
