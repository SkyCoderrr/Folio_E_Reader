import { describe, expect, it } from 'vitest';
import { chooseRenderer, createRenderer } from './createRenderer';
import { FlowRenderer } from './FlowRenderer';
import { PaginatorRenderer } from './PaginatorRenderer';

describe('chooseRenderer (ADR-005)', () => {
  it('defaults to one page in scroll flow', () => {
    expect(chooseRenderer({})).toBe('flow');
    expect(chooseRenderer({ flow: 'scroll', pagesPerView: 1 })).toBe('flow');
  });

  it('paged + 1 uses the paginator', () => {
    expect(chooseRenderer({ flow: 'paged', pagesPerView: 1 })).toBe('paged');
    expect(chooseRenderer({ flow: 'paged' })).toBe('paged');
  });

  it('two pages are the filmstrip in both flows, and never fall back to another renderer', () => {
    expect(chooseRenderer({ flow: 'scroll', pagesPerView: 2 })).toBe('filmstrip');
    expect(chooseRenderer({ flow: 'paged', pagesPerView: 2 })).toBe('filmstrip');
    expect(chooseRenderer({ pagesPerView: 2 })).toBe('filmstrip');
  });
});

describe('createRenderer', () => {
  it('builds the renderer the decision names', () => {
    expect(createRenderer({}).renderer).toBeInstanceOf(FlowRenderer);
    const strip = createRenderer({ pagesPerView: 2 });
    expect(strip.renderer).toBeInstanceOf(PaginatorRenderer);
    expect(strip.kind).toBe('filmstrip');
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

  it('every renderer is a typed scroll target: continuous (flow) or paged (paginator)', () => {
    const flow = createRenderer({}).renderer;
    expect(flow.kind).toBe('continuous');
    if (flow.kind === 'continuous') {
      expect(flow.getScrollTop()).toBe(0); // unmounted renderers are inert
      expect(flow.getMaxScroll()).toBe(0);
    }
    for (const layout of [{ flow: 'paged' as const }, { pagesPerView: 2 as const }]) {
      const r = createRenderer(layout).renderer;
      expect(r.kind).toBe('paged');
      if (r.kind === 'paged') {
        expect(r.holdStart(1)).toBe(false); // unmounted: no page, no hold
        expect(r.holdMove(10)).toBe(false);
      }
    }
    for (const r of [new FlowRenderer(), new PaginatorRenderer(), new PaginatorRenderer({ pagesPerView: 2 })])
      for (const m of ['page', 'goToSectionEdge', 'getEffectivePagesPerView', 'setMinSpreadWidth', 'isAtEnd'])
        expect(typeof (r as unknown as Record<string, unknown>)[m]).toBe('function');
  });
});
