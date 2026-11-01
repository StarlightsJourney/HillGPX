import { describe, expect, it } from 'vitest';
import design from './design.css?raw';
import styles from './styles.css?raw';

/**
 * An unclosed rule makes a browser read every rule after it as nested inside it, so the styles
 * that follow silently stop applying (this once broke the whole share dialog). Cheap to catch.
 */
function unclosed(css: string): { depth: number; negativeAt: number | null } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let depth = 0;
  let negativeAt: number | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth < 0 && negativeAt === null) negativeAt = text.slice(0, i).split('\n').length;
    }
  }
  return { depth, negativeAt };
}

describe('stylesheets', () => {
  it.each([
    ['design.css', design],
    ['styles.css', styles],
  ])('%s closes every rule it opens', (_name, css) => {
    expect(unclosed(css)).toEqual({ depth: 0, negativeAt: null });
  });
});
