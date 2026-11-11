import { describe, expect, it } from 'vitest';
import { chooseRenderer, createRenderer } from './createRenderer';
import { FlowRenderer } from './FlowRenderer';
import { PageGridRenderer } from './PageGridRenderer';
import { PaginatorRenderer } from './PaginatorRenderer';

describe('chooseRenderer (ADR-005)', () => {
  it('defaults to one page in scroll flow', () => {
    expect(chooseRenderer({})).toEqual({ kind: 'flow', fallback: null, support: null });
    expect(chooseRenderer({ flow: 'scroll', pagesPerView: 1 }).kind).toBe('flow');
  });

  it('paged + 1 uses the paginator', () => {
    expect(chooseRenderer({ flow: 'paged', pagesPerView: 1 })).toEqual({ kind: 'paged', fallback: null, support: null });
    expect(chooseRenderer({ flow: 'paged' }).kind).toBe('paged');
  });

  it('two pages are the filmstrip in both flows, and never fall back to another renderer', () => {
    expect(chooseRenderer({ flow: 'scroll', pagesPerView: 2 })).toEqual({ kind: 'filmstrip', fallback: null, support: null });
    expect(chooseRenderer({ flow: 'paged', pagesPerView: 2 }).kind).toBe('filmstrip');
    expect(chooseRenderer({ pagesPerView: 2 }).kind).toBe('filmstrip');
  });
});

describe('createRenderer', () => {
  it('builds the renderer the decision names', () => {
    expect(createRenderer({}).renderer).toBeInstanceOf(FlowRenderer);
    const strip = createRenderer({ pagesPerView: 2 }, { pageGapPx: 32 });
    expect(strip.renderer).toBeInstanceOf(PaginatorRenderer);
    expect(strip.kind).toBe('filmstrip');
    expect(strip.fallback).toBeNull();
    const paged = createRenderer({ flow: 'paged', pagesPerView: 2 }, { minSpreadWidthPx: 1200 });
    expect(paged.renderer).toBeInstanceOf(PaginatorRenderer);
    expect(paged.kind).toBe('filmstrip');
    const one = createRenderer({ flow: 'paged' });
    expect(one.kind).toBe('paged');
    expect(one.renderer.getEffectivePagesPerView()).toBe(1);
  });

  it('a fresh profile (no layout saved) gets scroll flow, one page', () => {
    const fresh = createRenderer({});
    expect(fresh.kind).toBe('flow');
    expect(fresh.renderer.getEffectivePagesPerView()).toBe(1);
  });

  it('exposes the same scroll-target API on every renderer (smoothScroller drives any)', () => {
    const renderers = [new FlowRenderer(), new PageGridRenderer(), new PaginatorRenderer(), new PaginatorRenderer({ pagesPerView: 2 })];
    for (const r of renderers) {
      for (const m of [
        'scrollBy',
        'getScrollTop',
        'getMaxScroll',
        'getLineHeight',
        'page',
        'cancelScrollAnimation',
        'goToSectionEdge',
        'getEffectivePagesPerView',
        'setMinSpreadWidth',
      ]) {
        expect(typeof (r as unknown as Record<string, unknown>)[m]).toBe('function');
      }
      expect(r.getScrollTop()).toBe(0); // unmounted renderers are inert
      expect(r.getMaxScroll()).toBe(0);
    }
    // Page-based renderers announce it to the auto-scroller and take the press hooks.
    expect(new PaginatorRenderer().turnsPages).toBe(true);
    expect(typeof new PaginatorRenderer().holdStart).toBe('function');
    expect(typeof new PaginatorRenderer().holdEnd).toBe('function');
    // ReaderView routes page keys through the smoothScroller only for page-turning renderers.
    expect(createRenderer({ pagesPerView: 2 }).renderer.turnsPages).toBe(true);
    expect(createRenderer({ flow: 'paged' }).renderer.turnsPages).toBe(true);
    expect(createRenderer({}).renderer.turnsPages).toBeUndefined();
  });
});
