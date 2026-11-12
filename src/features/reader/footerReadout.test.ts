import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildTocSpans, classifyToc, tocOrdinal, type TocSpan } from '../toc/tocModel';
import { footerReadout as readout } from './footerReadout';
import type { FooterProgress } from '@contract/types';

const footerReadout = (mode: FooterProgress, s: readonly TocSpan[], pos?: { sectionIndex: number; progress: number }) =>
  readout(mode, tocOrdinal(s, classifyToc(s, pos).currentKey), pos?.progress);

const toc = [
  { label: 'A', href: 's0.html', subitems: [{ label: 'A1', href: 's1.html' }] },
  { label: 'B', href: 's2.html' },
  { label: 'C', href: 's3.html' },
  { label: 'Ext', href: 'http://x' },
];
const info = {
  resolve: (h: string) => ({ 's0.html': 0, 's1.html': 1, 's2.html': 2, 's3.html': 3 })[h] ?? null,
  weights: [10, 10, 10, 10],
  chapterKey: (start: number) => `s:${start}#`,
};
const spans = buildTocSpans(toc, info);
const at = (sectionIndex: number, progress: number) => ({ sectionIndex, progress });

it('t31u: each mode shows its text (chapter counts resolved entries, all depths, pre-order)', () => {
  expect(footerReadout('off', spans, at(2, 0.55))).toBeNull();
  expect(footerReadout('percent', spans, at(2, 0.55))).toBe('55%');
  expect(footerReadout('chapter', spans, at(2, 0.55))).toBe('3/4');
  expect(footerReadout('both', spans, at(2, 0.55))).toBe('3/4 · 55%');
});

it('t31u: updates with the position', () => {
  expect(footerReadout('both', spans, at(0, 0))).toBe('1/4 · 0%');
  expect(footerReadout('both', spans, at(1, 0.3))).toBe('2/4 · 30%');
  expect(footerReadout('both', spans, at(3, 1))).toBe('4/4 · 100%');
});

it('t31u: no TOC → chapter shows nothing, both shows only %', () => {
  expect(footerReadout('chapter', [], at(0, 0.4))).toBeNull();
  expect(footerReadout('both', [], at(0, 0.4))).toBe('40%');
  expect(footerReadout('percent', spans, undefined)).toBeNull();
});

it('t31u: the readout has no bar styling (text only, no hit-testing)', () => {
  const css = readFileSync('src/features/reader/ReaderChrome.module.css', 'utf8');
  const rule = /\n\.readout \{([^}]*)\}/.exec(css)![1];
  expect(rule).not.toMatch(/background|border|box-shadow|height|padding/);
  expect(rule).toMatch(/pointer-events:\s*none/);
});

it('t32u: scroll flow runs text under the readout; a page-colour halo keeps it legible (still no fill)', () => {
  const css = readFileSync('src/features/reader/ReaderChrome.module.css', 'utf8');
  const rule = /\n\.readout \{([^}]*)\}/.exec(css)![1];
  expect(rule).toMatch(/text-shadow:[^;]*var\(--reader-bg\)/);
  expect(rule).not.toMatch(/background|box-shadow/);
});
