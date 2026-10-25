import { describe, expect, it } from 'vitest';
import { takenMessage, usernameProblem } from './username';

describe('usernameProblem', () => {
  it('accepts 3–24 letters, numbers, dots, dashes and underscores', () => {
    for (const name of ['abc', 'Hill_Climber.9', 'a-b-c', 'x'.repeat(24)]) expect(usernameProblem(name)).toBeNull();
  });

  it('asks for at least 3 characters', () => {
    expect(usernameProblem('')).toBe('Use at least 3 characters.');
    expect(usernameProblem('ab')).toBe('Use at least 3 characters.');
    expect(usernameProblem('  a ')).toBe('Use at least 3 characters.');
  });

  it('asks for 24 characters or fewer', () => {
    expect(usernameProblem('x'.repeat(25))).toBe('Use 24 characters or fewer.');
  });

  it('rejects anything outside letters, numbers, dots, dashes and underscores', () => {
    expect(usernameProblem('has space')).toBe('Use only letters, numbers, dots, dashes or underscores.');
    expect(usernameProblem('émile')).toBe('Use only letters, numbers, dots, dashes or underscores.');
    expect(usernameProblem('a@b!')).toBe('Use only letters, numbers, dots, dashes or underscores.');
  });

  it('words the taken message with the trimmed name', () => {
    expect(takenMessage(' ridge ')).toBe('@ridge is already taken. Try another.');
  });
});
