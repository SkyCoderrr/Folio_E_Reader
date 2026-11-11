// @vitest-environment jsdom
/**
 * Window resize in scroll flow (owner t20u #2: F11 full screen, maximize/restore). jsdom has no
 * layout, so FlowSlots is a model whose section heights depend on the window width (narrower =
 * more lines = taller) and height-independent text. The renderer's resize path (coalescing, anchor
 * capture before relayout, restore after, burst reuse, animation cancel, relocate) is the real code,
 * as are captureAnchor / restoreTarget / locatorOf (their fraction path: no section documents).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookSource } from '../book/BookSource';
import { compileStyle } from '../style/compileStyle';
import { DEFAULT_READING_STYLE } from '../style/readingStyle';
import { FlowRenderer } from './FlowRenderer';

const state = vi.hoisted(() => ({ w: 1280, h: 720, chars: [40000, 90000, 30000], relayouts: 0 }));

vi.mock('./flow/flowSlots', async () => {
  const { SlotLayout } = await import('./flow/slotLayout');
  return {
    FlowSlots: class {
      scroller = document.createElement('div');
      layout = new SlotLayout(3, { padTop: 0, padBottom: 0, separatorPx: 0 });
      textAnchor = null;
      stats = {};
      pxPerUnit = 1;
      constructor(host: HTMLElement) {
        Object.defineProperties(this.scroller, {
          clientWidth: { get: () => state.w },
          clientHeight: { get: () => state.h },
          scrollHeight: { get: () => this.layout.totalHeight },
        });
        host.append(this.scroller);
        this.applyStyle();
      }
      applyStyle() {
        state.relayouts++;
        const perLine = Math.max(1, Math.floor((state.w - 160) / 10));
        state.chars.forEach((c, i) => this.layout.setContentHeight(i, Math.ceil(c / perLine) * 30, true));
      }
      frameAt(index: number) {
        return { index, ready: true, doc: null, text: () => null };
      }
      ensureMounted(index: number) {
        return Promise.resolve(this.frameAt(index));
      }
      mountedIndices() {
        return [0, 1, 2];
      }
      reconcile() {}
      destroy() {
        this.scroller.remove();
      }
    },
  };
});

let time: number;
let id: number;
let frames: Map<number, FrameRequestCallback>;
let renderer: FlowRenderer;
const flush = (): void => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((cb) => cb(time));
};
const advance = (ms: number): void => {
  const end = time + ms;
  while (time < end - 1e-7) {
    time = Math.min(end, time + 1000 / 60);
    flush();
  }
};
const size = (w: number, h: number): void => {
  state.w = w;
  state.h = h;
  renderer.resize();
  flush();
};
/** Reading position as a book fraction (section + position inside it). */
const where = () => {
  const l = renderer.getLocator();
  return { section: l.sectionIndex, progress: l.progress };
};

beforeEach(async () => {
  time = id = 0;
  frames = new Map();
  state.w = 1280;
  state.h = 720;
  state.relayouts = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (n: number) => frames.delete(n));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  renderer = new FlowRenderer();
  const host = document.createElement('div');
  document.body.append(host);
  await renderer.mount(host, { sections: state.chars.map((size) => ({ size })) } as unknown as BookSource, compileStyle(DEFAULT_READING_STYLE));
  advance(50);
});

afterEach(() => {
  renderer.destroy();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FlowRenderer window resize (t20u #2)', () => {
  it('1280x720 -> 1920x1080 -> 1280x720 (slow steps) keeps the reading position', async () => {
    renderer.setScrollTop(12345); // inside section 1
    vi.advanceTimersByTime(500);
    const before = where();
    expect(before.section).toBe(1);
    for (const [w, h] of [[1920, 1080], [1280, 720], [1920, 1080], [1280, 720]] as Array<[number, number]>) {
      const top = renderer.getScrollTop();
      size(w, h);
      vi.advanceTimersByTime(300); // each change settles before the next
      expect(where().section).toBe(before.section);
      expect(where().progress).toBeCloseTo(before.progress, 9);
      expect(renderer.getScrollTop()).not.toBe(top); // the layout really changed under it
    }
  });

  it('a burst (F11 relayout in several frames) relays out once per frame and reuses the first anchor', () => {
    renderer.setScrollTop(30000);
    vi.advanceTimersByTime(500);
    const before = where();
    const relocates: string[] = [];
    renderer.on('relocate', (e) => relocates.push(e.reason));
    const n = state.relayouts;
    for (const [w, h] of [[1500, 800], [1920, 1080], [1700, 900], [1280, 720]] as Array<[number, number]>) {
      state.w = w;
      state.h = h;
      renderer.resize();
      renderer.resize(); // several observer callbacks in one frame
      flush();
      vi.advanceTimersByTime(16);
    }
    expect(state.relayouts - n).toBe(4);
    expect(where().progress).toBeCloseTo(before.progress, 9);
    vi.advanceTimersByTime(250);
    expect(relocates).toEqual(['resize']); // one relocate after the burst
    size(1280, 720); // same size again: no relayout
    expect(state.relayouts - n).toBe(4);
  });

  it('a resize during a PgDn animation stops it where it is and keeps that position both ways', () => {
    renderer.setScrollTop(5000);
    vi.advanceTimersByTime(500);
    renderer.page(1);
    advance(50); // mid-animation
    const before = where();
    size(1920, 1080);
    advance(400);
    expect(where().progress).toBeCloseTo(before.progress, 9); // no stale animation continued
    vi.advanceTimersByTime(300);
    size(1280, 720);
    vi.advanceTimersByTime(300);
    expect(where().progress).toBeCloseTo(before.progress, 9);
  });
});
