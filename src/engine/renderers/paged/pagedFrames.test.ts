// @vitest-environment jsdom
/** t24u: nothing but the page colour is painted behind the text (no gutter tabs, no mount flash). */
import { describe, expect, it } from 'vitest';
import type { BookSource } from '../../book/BookSource';
import { compileStyle } from '../../style/compileStyle';
import { DEFAULT_READING_STYLE } from '../../style/readingStyle';
import { PagedFrames } from './pagedFrames';

const book = { sections: [] } as unknown as BookSource;
const hooks = { frame: { onKey: () => {}, onWheel: () => {}, onLink: () => {} }, onSectionReady() {}, onReflow() {}, onClick() {} };

describe('PagedFrames backdrop', () => {
  for (const cols of [1, 2] as const) {
    it(`${cols} page(s): the root is the plain page background, no paper/desk layers`, () => {
      const host = document.createElement('div');
      document.body.append(host);
      const css = compileStyle(DEFAULT_READING_STYLE);
      const f = new PagedFrames(host, book, css, 48, () => cols, hooks);
      expect(f.root.style.backgroundColor).not.toBe('');
      expect(f.root.style.backgroundImage === '' || f.root.style.backgroundImage === 'none').toBe(true);
      expect([...f.root.children].map((c) => c.className)).toEqual(['er-paged-clip']);
      f.destroy();
      host.remove();
    });
  }
});
