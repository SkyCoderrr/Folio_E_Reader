// @vitest-environment jsdom
/** Narrow-window fallback in two-page scroll (PageGridRenderer), with layout-free fake slots. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BookSource } from '../book/BookSource';
import { compileStyle } from '../style/compileStyle';
import { DEFAULT_READING_STYLE } from '../style/readingStyle';
import { PageGridRenderer } from './PageGridRenderer';
import type { SpreadEvent } from './Renderer';

const state = vi.hoisted(() => ({ width: 1600, applied: [] as Array<1 | 2> }));

vi.mock('./grid/gridSlots', async () => {
  const { SlotLayout } = await import('./flow/slotLayout');
  const { effectivePages, gridGeometry } = await import('./grid/gridMath');
  return {
    GridSlots: class {
      scroller = document.createElement('div');
      layout = new SlotLayout(1, { padTop: 0, padBottom: 0, separatorPx: 0 }, 900);
      textAnchor = null;
      geometry!: ReturnType<typeof gridGeometry>;
      minSpreadWidthPx: number;
      constructor(host: HTMLElement, _b: unknown, _s: unknown, _g: number, _h: unknown, min: number) {
        this.minSpreadWidthPx = min;
        Object.defineProperties(this.scroller, {
          clientWidth: { get: () => state.width },
          clientHeight: { value: 900 },
          scrollHeight: { value: 900 },
        });
        host.append(this.scroller);
        this.applyStyle();
      }
      applyStyle() {
        const cols = effectivePages(2, state.width, this.minSpreadWidthPx);
        state.applied.push(cols);
        this.geometry = gridGeometry({ viewportW: state.width, viewportH: 900, gapPx: 48, marginXPx: 48, marginYPx: 40, maxLineWidthPx: 720, cols });
      }
      frameAt() {
        return null;
      }
      ensureMounted() {
        return Promise.resolve(null);
      }
      reconcile() {}
      destroy() {
        this.scroller.remove();
      }
    },
  };
});

let raf: FrameRequestCallback[];
beforeEach(() => {
  state.width = 1600;
  state.applied = [];
  raf = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => raf.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('two-page scroll shows one page per row below minSpreadWidthPx and recovers when wide', async () => {
  const r = new PageGridRenderer({ minSpreadWidthPx: 1000 });
  const events: SpreadEvent[] = [];
  r.on('spread', (e) => events.push(e));
  const host = document.createElement('div');
  document.body.append(host);
  await r.mount(host, { sections: [{ size: 10 }] } as unknown as BookSource, compileStyle(DEFAULT_READING_STYLE));
  const resize = (w: number) => {
    state.width = w;
    r.resize();
    for (const cb of raf.splice(0)) cb(0);
  };
  expect(r.getEffectivePagesPerView()).toBe(2);
  resize(800);
  expect(r.getEffectivePagesPerView()).toBe(1);
  resize(1300);
  expect(r.getEffectivePagesPerView()).toBe(2);
  r.setMinSpreadWidth(1400);
  expect(r.getEffectivePagesPerView()).toBe(1);
  expect(events).toEqual([
    { pagesPerView: 2, requested: 2 },
    { pagesPerView: 1, requested: 2 },
    { pagesPerView: 2, requested: 2 },
    { pagesPerView: 1, requested: 2 },
  ]);
  r.destroy();
});
