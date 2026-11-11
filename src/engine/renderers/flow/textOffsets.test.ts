import { describe, it, expect } from 'vitest';
import { buildStarts, findNearestSnippet, locateOffset, makeSnippet } from './textOffsets';
import { frameBaseCss } from './frameCss';

describe('locateOffset', () => {
  const lengths = [5, 3, 10];
  const t = { ...buildStarts(lengths), lengths };
  it('builds starts and total', () => {
    expect(t.starts).toEqual([0, 5, 8]);
    expect(t.total).toBe(18);
  });
  it('maps offsets to node + inner offset; boundaries go to the next node', () => {
    expect(locateOffset(t, 0)).toEqual({ node: 0, inner: 0 });
    expect(locateOffset(t, 4)).toEqual({ node: 0, inner: 4 });
    expect(locateOffset(t, 5)).toEqual({ node: 1, inner: 0 });
    expect(locateOffset(t, 9)).toEqual({ node: 2, inner: 1 });
  });
  it('clamps out-of-range offsets', () => {
    expect(locateOffset(t, -3)).toEqual({ node: 0, inner: 0 });
    expect(locateOffset(t, 18)).toEqual({ node: 2, inner: 10 });
    expect(locateOffset(t, 999)).toEqual({ node: 2, inner: 10 });
  });
  it('returns null without text', () => {
    expect(locateOffset({ starts: [], lengths: [], total: 0 }, 0)).toBeNull();
  });
});

describe('makeSnippet', () => {
  it('collapses whitespace and limits length', () => {
    expect(makeSnippet('  a\n\n b\tc  ')).toBe('a b c');
    expect(makeSnippet('x'.repeat(40))).toHaveLength(32);
  });
  it('does not split a surrogate pair', () => {
    const s = 'a'.repeat(31) + '😀';
    expect(makeSnippet(s)).toBe('a'.repeat(31));
  });
});

describe('findNearestSnippet', () => {
  const text = 'It was the best of times. ' + 'filler '.repeat(50) + 'It was the best of times.';
  it('finds the occurrence nearest the expected offset', () => {
    expect(findNearestSnippet(text, 'It was the best', 0)).toBe(0);
    expect(findNearestSnippet(text, 'It was the best', text.length - 10)).toBe(text.lastIndexOf('It was'));
  });
  it('is whitespace-insensitive and escapes regex characters', () => {
    expect(findNearestSnippet('a (b)\n c?', '(b) c?', 0)).toBe(2);
  });
  it('returns -1 when absent or outside the radius', () => {
    expect(findNearestSnippet(text, 'nope', 0)).toBe(-1);
    expect(findNearestSnippet(text, 'It was the best', text.length, 10)).toBe(-1);
  });
});

describe('frameBaseCss', () => {
  it('forces a single column on every element and auto height on the root', () => {
    const css = frameBaseCss({ mediaMaxHeightPx: 700 });
    expect(css).toMatch(/\*, \*::before, \*::after \{[^}]*column-count: auto !important/);
    expect(css).toMatch(/html \{[^}]*height: auto !important/);
    expect(css).toContain('max-height: 700px !important');
  });
});
