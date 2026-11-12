import { describe, expect, it, vi } from 'vitest';
import type { BookSource } from '../book/BookSource';
import { PinSet, RendererEmitter, resolveLink } from './rendererParts';

describe('PinSet', () => {
  it('keeps a section pinned until every overlapping navigation released it', () => {
    const p = new PinSet();
    p.pin(3, 1);
    p.pin(3, 1);
    p.pin(3, -1);
    expect(p.pinned.has(3)).toBe(true);
    p.pin(3, -1);
    expect(p.pinned.has(3)).toBe(false);
  });
});

describe('RendererEmitter', () => {
  it('delivers, unsubscribes, and isolates throwing listeners', () => {
    const e = new RendererEmitter('test');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: number[] = [];
    e.on('section', () => {
      throw new Error('boom');
    });
    const off = e.on('section', ({ index }) => got.push(index));
    e.emit('section', { index: 1 });
    off();
    e.emit('section', { index: 2 });
    expect(got).toEqual([1]);
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

describe('resolveLink', () => {
  const book = {
    sections: [{ id: 'text/ch1.xhtml', resolveHref: (h: string) => `text/${h}` }],
  } as unknown as BookSource;

  it('separates external links from in-book hrefs', () => {
    expect(resolveLink(book, 0, 'https://example.org')).toEqual({ external: 'https://example.org' });
    expect(resolveLink(book, 0, '#note1')).toEqual({ href: 'text/ch1.xhtml#note1' });
    expect(resolveLink(book, 0, 'ch2.xhtml#a')).toEqual({ href: 'text/ch2.xhtml#a' });
    expect(resolveLink(book, 0, 'blob:abc')).toEqual({ href: 'text/blob:abc' });
    expect(resolveLink(book, 0, '')).toBeNull();
  });
});
