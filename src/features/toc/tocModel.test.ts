import { describe, expect, it } from 'vitest';
import type { TocItem } from '../../engine/book/BookSource';
import { buildTocSpans, chapterKeyFor, classifyToc, tocLabelAt, type TocBookInfo } from './tocModel';

// 5 sections, sizes 100 each. href "sN" -> section N.
const info = (n = 5, format: 'epub' | 'txt' = 'epub'): TocBookInfo => ({
  resolve: (h) => (/^s\d+/.test(h) ? Number(h.slice(1).split('#')[0]) : null),
  sizes: Array(n).fill(100),
  format,
});
const flat: TocItem[] = [0, 1, 2, 3, 4].map((i) => ({ label: `C${i}`, href: `s${i}` }));
const at = (sectionIndex: number, progress: number) => ({ sectionIndex, progress });

describe('chapterKey scheme', () => {
  it('EPUB: s:<spine>#<fragment or empty>; TXT: t:<chapter index>; unresolved: null', () => {
    expect(chapterKeyFor('epub', 3, 'ch3.xhtml')).toBe('s:3#');
    expect(chapterKeyFor('epub', 3, 'ch3.xhtml#sec2')).toBe('s:3#sec2');
    expect(chapterKeyFor('txt', 7, 's7')).toBe('t:7');
    expect(chapterKeyFor('epub', null, 'http://x')).toBeNull();
  });
  it('spans carry stable keys that do not depend on the position', () => {
    const toc: TocItem[] = [
      { label: 'a', href: 's0#top' },
      { label: 'b', href: 's2' },
    ];
    expect(buildTocSpans(toc, info()).map((s) => s.chapterKey)).toEqual(['s:0#top', 's:2#']);
    expect(buildTocSpans(flat.slice(0, 2), info(5, 'txt')).map((s) => s.chapterKey)).toEqual([
      't:0',
      't:1',
    ]);
  });
});

describe('classifyToc (last-read chapter only; no inferred read state)', () => {
  it('current is the entry containing the position; nothing before it is inferred', () => {
    const r = classifyToc(buildTocSpans(flat, info()), at(2, 0.5));
    expect(r.currentKey).toBe('2');
    expect(r.currentChapterKey).toBe('s:2#');
    expect(r).not.toHaveProperty('states');
  });
  it('a section between chapters belongs to the previous chapter', () => {
    const r = classifyToc(buildTocSpans([flat[0], flat[3]], info()), at(2, 0.5));
    expect(r.currentKey).toBe('0');
  });
  it('no current entry before the first chapter or without a position', () => {
    const spans = buildTocSpans([flat[2], flat[3]], info());
    expect(classifyToc(spans, at(1, 0.2)).currentKey).toBeNull();
    expect(classifyToc(spans, null).currentKey).toBeNull();
  });
  it('rounds the in-chapter percentage, never 100% before the end of the book', () => {
    const spans = buildTocSpans(flat, info());
    expect(classifyToc(spans, at(1, 0.2 + 0.026)).percent).toBe(13);
    expect(classifyToc(spans, at(1, 0.2)).percent).toBe(0);
    expect(classifyToc(spans, at(1, 0.3999)).percent).toBe(99);
    expect(classifyToc(spans, at(4, 0.9)).percent).toBe(50);
    expect(classifyToc(spans, at(4, 0.9999)).percent).toBe(99);
    expect(classifyToc(spans, at(4, 1)).percent).toBe(100);
  });
  it('nested: the deepest entry is current', () => {
    const toc: TocItem[] = [
      { label: 'Part I', href: 's0', subitems: [{ label: 'a', href: 's0' }, { label: 'b', href: 's1' }] },
      { label: 'Part II', href: 's2', subitems: [{ label: 'c', href: 's3' }, { label: 'd', href: 's4' }] },
    ];
    expect(classifyToc(buildTocSpans(toc, info()), at(3, 0.7)).currentKey).toBe('1.0');
    expect(classifyToc(buildTocSpans(toc, info()), at(0, 0.1)).currentKey).toBe('0.0');
  });
  it('unresolvable hrefs are never current', () => {
    const toc: TocItem[] = [{ label: 'x', href: 'http://x' }, ...flat];
    expect(classifyToc(buildTocSpans(toc, info()), at(1, 0.3)).currentKey).toBe('2');
  });
  it('TXT: chapters are sections with char sizes, weighted by size', () => {
    const txt: TocBookInfo = { resolve: info().resolve, sizes: [1000, 3000], format: 'txt' };
    const r = classifyToc(buildTocSpans(flat.slice(0, 2), txt), at(1, 0.25 + 0.75 * 0.4));
    expect(r.currentKey).toBe('1');
    expect(r.currentChapterKey).toBe('t:1');
    expect(r.percent).toBe(40);
  });
});

// t32u: several entries share ONE spine section and differ only by #fragment.
describe('classifyToc with several chapters in one section (fragment offsets)', () => {
  // section 0 = cover + front matter, section 1 = chapters I..III (1000 chars), section 2 = IV
  const frag: TocBookInfo = {
    resolve: info().resolve,
    sizes: [50, 1000, 100],
    chars: [50, 1000, 100],
    format: 'epub',
    offsets: new Map([
      ['s1#c1', 0],
      ['s1#c2', 300],
      ['s1#c3', 700],
    ]),
  };
  const toc: TocItem[] = [
    { label: 'Title', href: 's0' },
    { label: 'I', href: 's1#c1' },
    { label: 'II', href: 's1#c2' },
    { label: 'III', href: 's1#c3' },
    { label: 'IV', href: 's2' },
  ];
  const spans = buildTocSpans(toc, frag);
  const pos = (sectionIndex: number, charOffset: number, base = [0, 50, 1050]) => ({
    sectionIndex,
    charOffset,
    progress: (base[sectionIndex] + charOffset) / 1150,
  });
  it('the current entry is the last one starting at or before the position', () => {
    expect(classifyToc(spans, pos(1, 0)).currentKey).toBe('1');
    expect(classifyToc(spans, pos(1, 299)).currentKey).toBe('1');
    expect(classifyToc(spans, pos(1, 300)).currentKey).toBe('2');
    expect(classifyToc(spans, pos(1, 650)).currentChapterKey).toBe('s:1#c2');
    expect(classifyToc(spans, pos(1, 999)).currentKey).toBe('3');
    expect(classifyToc(spans, pos(2, 0)).currentKey).toBe('4');
    expect(classifyToc(spans, pos(0, 10)).currentKey).toBe('0');
  });
  it('in-chapter percent uses the entry range (its start to the next entry start)', () => {
    expect(classifyToc(spans, pos(1, 300)).percent).toBe(0);
    expect(classifyToc(spans, pos(1, 500)).percent).toBe(50); // 300..700
    expect(classifyToc(spans, pos(1, 360)).percent).toBe(15);
    expect(classifyToc(spans, pos(1, 850)).percent).toBe(50); // III: 700..1000 of the section
  });
  it('ranges: from/to come from the offsets; document order does not matter', () => {
    const s = spans.map((x) => [x.from, x.to]);
    expect(s[2][0]).toBeCloseTo(350 / 1150);
    expect(s[2][1]).toBeCloseTo(750 / 1150);
    expect(s[3][1]).toBeCloseTo(1050 / 1150);
  });
  it('without measured offsets (pending) all entries of a section start at its start: first wins', () => {
    const rough = buildTocSpans(toc, { ...frag, offsets: undefined });
    expect(classifyToc(rough, pos(1, 650)).currentKey).toBe('1');
  });
  it('while offsets are being measured (pending) a shared section has no current entry, never a guess', () => {
    const pending = buildTocSpans(toc, { ...frag, chars: undefined, offsets: undefined, pending: true });
    expect(pending.map((s) => s.unsure)).toEqual([false, true, true, true, false]);
    for (const off of [0, 400, 900]) {
      const r = classifyToc(pending, pos(1, off));
      expect(r).toMatchObject({ currentKey: null, currentChapterKey: null, percent: null, unsure: true });
    }
    // sections with a single entry are unambiguous and still resolve while pending
    expect(classifyToc(pending, pos(2, 10)).currentKey).toBe('4');
    expect(classifyToc(pending, pos(0, 10)).currentKey).toBe('0');
    // once measured the same positions resolve normally
    expect(classifyToc(spans, pos(1, 400)).currentKey).toBe('2');
    expect(classifyToc(spans, pos(1, 400)).unsure).toBeUndefined();
  });
  it('nested entries that start at the same place: the deepest one is current', () => {
    const nested: TocItem[] = [
      { label: 'Part', href: 's1#c1', subitems: [{ label: 'I', href: 's1#c1' }, { label: 'II', href: 's1#c2' }] },
    ];
    const sp = buildTocSpans(nested, frag);
    expect(classifyToc(sp, pos(1, 100)).currentKey).toBe('0.0');
    expect(classifyToc(sp, pos(1, 400)).currentKey).toBe('0.1');
  });
});

it('tocLabelAt resolves row keys to labels', () => {
  const toc: TocItem[] = [{ label: 'A', href: 'a', subitems: [{ label: ' B ', href: 'b' }] }];
  expect(tocLabelAt(toc, '0')).toBe('A');
  expect(tocLabelAt(toc, '0.0')).toBe('B');
  expect(tocLabelAt(toc, '1')).toBeNull();
});
