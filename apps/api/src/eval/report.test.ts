import { describe, expect, it } from 'vitest';
import { BEGIN, END, spliceReport } from './report';

describe('spliceReport', () => {
  it('replaces only the generated block', () => {
    const current = `# Evals\n\nBy hand.\n\n${BEGIN}\nold numbers\n${END}\n\n## Proposals\n\nBy hand too.\n`;
    expect(spliceReport(current, 'new numbers')).toBe(
      `# Evals\n\nBy hand.\n\n${BEGIN}\n\nnew numbers\n\n${END}\n\n## Proposals\n\nBy hand too.\n`,
    );
  });

  it('refuses a file without both markers in order', () => {
    expect(() => spliceReport(`${END}\n${BEGIN}`, 'x')).toThrow(/markers/);
    expect(() => spliceReport('# Evals', 'x')).toThrow(/markers/);
  });
});
