// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { BookSource, TocItem } from '../../engine/book/BookSource';
import { footerReadout } from '../reader/footerReadout';
import { buildTocSpans, classifyToc } from './tocModel';
import { measureToc } from './tocOffsets';

const html = `<html><body><h1 id="t">PRIDE</h1><h2 id="c1">Chapter I.</h2><p>${'a'.repeat(100)}</p><h2 id="c2">Chapter II.</h2><p>${'b'.repeat(100)}</p><h2 id="c5">Chapter V.</h2><p>${'c'.repeat(100)}</p></body></html>`;

function source(): BookSource {
  const doc = () => new DOMParser().parseFromString(html, 'text/html');
  return {
    format: 'epub',
    metadata: { title: 'x' },
    toc: [],
    sections: [
      { id: 'a', linear: true, size: 9999, load: async () => '', unload() {}, createDocument: async () => doc() },
    ],
    resolveHref(href) {
      const [path, frag] = href.split('#');
      if (path !== 'a.xhtml') return null;
      return { index: 0, anchor: (d) => (frag ? d.getElementById(frag) : null) };
    },
    splitTOCHref: (h) => h.split('#') as [string, string?],
    destroy() {},
  };
}

it('resolves #fragment entries of one section to char offsets; current entry/readout follow', async () => {
  const toc: TocItem[] = ['t', 'c1', 'c2', 'c5'].map((f) => ({ label: f, href: `a.xhtml#${f}` }));
  const src = source();
  const { chars, offsets } = await measureToc(src, toc);
  expect(chars[0]).toBeGreaterThan(300);
  const o = ['t', 'c1', 'c2', 'c5'].map((f) => offsets.get(`a.xhtml#${f}`)!);
  expect(o[0]).toBe(0);
  expect(o[1]).toBe('PRIDE'.length);
  expect(o[2]).toBe('PRIDE'.length + 'Chapter I.'.length + 100);
  expect(o[3]).toBe(o[2] + 'Chapter II.'.length + 100);
  const spans = buildTocSpans(toc, {
    resolve: (h) => src.resolveHref(h)?.index ?? null,
    sizes: [9999],
    chars,
    offsets,
    format: 'epub',
  });
  const pos = (charOffset: number) => ({ sectionIndex: 0, charOffset, progress: charOffset / chars[0] });
  // reading Chapter V (its heading is the first visible text)
  expect(classifyToc(spans, pos(o[3])).currentKey).toBe('3');
  expect(footerReadout('chapter', spans, pos(o[3]))).toBe('4/4');
  expect(classifyToc(spans, pos(o[1] + 10)).currentChapterKey).toBe('s:0#c1');
  expect(classifyToc(spans, pos(o[1] + 10)).percent).toBeGreaterThanOrEqual(0);
  expect(classifyToc(spans, pos(o[2] - 1)).currentKey).toBe('1');
});
