// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/UI.md is the source of truth for the tokens (SPEC.md, UI section).
const uiDoc = readFileSync(new URL('../../../docs/UI.md', import.meta.url), 'utf8');
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const srcDir = fileURLToPath(new URL('.', import.meta.url));

function uiTokens(): { name: string; hex: string }[] {
  const section = uiDoc.split('## Tokens')[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^\| ([a-z0-9-]+) \| (#[0-9A-Fa-f]{6}) \|/gm)].map((match) => ({
    name: match[1] ?? '',
    hex: match[2] ?? '',
  }));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx', '.css'].includes(extname(entry.name)) ? [path] : [];
  });
}

describe('theme', () => {
  it('reads the token table from docs/UI.md', () => {
    expect(uiTokens()).toContainEqual({ name: 'bg', hex: '#0B0E13' });
  });

  it.each(uiTokens())('defines --color-$name as $hex', ({ name, hex }) => {
    expect(css).toMatch(new RegExp(`--color-${name}:\\s*${hex};`, 'i'));
  });

  it('removes the default Tailwind palette, so only UI.md colors exist', () => {
    expect(css).toMatch(/--color-\*:\s*initial;/);
  });

  it('keeps hex values out of components', () => {
    const offenders = sourceFiles(srcDir)
      .filter((path) => !path.endsWith('index.css') && !/\.test\.tsx?$/.test(path))
      .filter((path) => /#[0-9A-Fa-f]{3,8}\b/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
