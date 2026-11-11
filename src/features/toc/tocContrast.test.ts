import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { contrast, luminance, parseHex } from '../reader/ReaderChrome.colors';

const css = readFileSync(new URL('../../ui/tokens.css', import.meta.url), 'utf8');
const tok = (n: string) => new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css)![1];
const toc = readFileSync(new URL('./toc.module.css', import.meta.url), 'utf8');

it('read chapters are ~half the unread luminance yet stay >= 3:1 on the sidebar (t28u)', () => {
  const unread = tok('text-1');
  const read = tok('toc-read');
  const ratio = luminance(parseHex(read)!) / luminance(parseHex(unread)!);
  expect(ratio).toBeGreaterThanOrEqual(0.45);
  expect(ratio).toBeLessThanOrEqual(0.55);
  for (const bg of ['surface-1', 'surface-2']) expect(contrast(read, tok(bg))).toBeGreaterThanOrEqual(3);
});

it('sidebar rows use text-1 (unread) and toc-read (read) - fixed dark chrome, independent of the reading preset', () => {
  expect(toc).toMatch(/\.item \{[^}]*color: var\(--text-1\)/);
  expect(toc).toMatch(/\.item\[data-read='true'\] \{\s*color: var\(--toc-read\)/);
});
