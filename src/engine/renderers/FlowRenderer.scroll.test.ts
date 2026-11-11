// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BookSource } from '../book/BookSource';
import { compileStyle } from '../style/compileStyle';
import { DEFAULT_READING_STYLE } from '../style/readingStyle';
import { FlowRenderer } from './FlowRenderer';

const state = vi.hoisted(() => ({ mounted: new Set([0, 1]), reduced: false }));
// Real navigation + animation + pixel writer, with deterministic mounted section geometry.
vi.mock('./flow/flowSlots', async () => {
  const { SlotLayout } = await import('./flow/slotLayout');
  return {
    FlowSlots: class {
      scroller = document.createElement('div');
      layout = new SlotLayout(3, { padTop: 0, padBottom: 0, separatorPx: 0 }, 2000);
      textAnchor = null;
      stats = {};
      constructor(host: HTMLElement) {
        Object.defineProperties(this.scroller, {
          clientWidth: { value: 1000 },
          clientHeight: { value: 800 },
          scrollHeight: { value: 6000 },
        });
        host.append(this.scroller);
      }
      frameAt(index: number) {
        return state.mounted.has(index) ? { index, ready: true } : null;
      }
      ensureMounted(index: number) {
        state.mounted.add(index);
        return Promise.resolve(this.frameAt(index));
      }
      reconcile() {}
      destroy() {
        this.scroller.remove();
      }
    },
  };
});
vi.mock('./flow/flowAnchor', async (original) => ({
  ...(await original<typeof import('./flow/flowAnchor')>()),
  captureAnchor: () => ({ index: 0, range: null }),
  textAnchorOf: () => null,
  locatorOf: () => ({ sectionIndex: 0, charOffset: 0 }),
}));

let time: number;
let id: number;
let frames: Map<number, FrameRequestCallback>;
let renderer: FlowRenderer;
beforeEach(async () => {
  time = id = 0;
  frames = new Map();
  state.reduced = false;
  state.mounted = new Set([0, 1]);
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (n: number) => frames.delete(n));
  vi.stubGlobal('matchMedia', () => ({ matches: state.reduced }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  renderer = new FlowRenderer();
  const host = document.createElement('div');
  document.body.append(host);
  await renderer.mount(
    host,
    { sections: [{ size: 1 }, { size: 1 }, { size: 1 }] } as BookSource,
    compileStyle(DEFAULT_READING_STYLE),
  );
});
afterEach(() => {
  renderer.destroy();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function advance(ms: number) {
  const end = time + ms;
  while (time < end - 1e-7) {
    time = Math.min(end, time + 1000 / 240);
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(time));
  }
}

it('pages by the overlap-preserving target and retargets another press without a write or stall', () => {
  renderer.page(1);
  expect(renderer.getScrollTop()).toBe(0);
  advance(50);
  const at = renderer.getScrollTop();
  renderer.page(1);
  expect(renderer.getScrollTop()).toBe(at);
  advance(1000 / 240);
  expect(renderer.getScrollTop()).toBeGreaterThan(at);
  advance(200);
  expect(renderer.getScrollTop()).toBe(1460);
  renderer.scrollElement!.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(1000);
  advance(500);
  expect(renderer.getScrollTop()).toBe(1460);
});

it('animates a mounted section edge within two viewports', async () => {
  renderer.setScrollTop(800);
  await renderer.goToSectionEdge(0, 'end');
  expect(renderer.getScrollTop()).toBe(800);
  advance(100);
  expect(renderer.getScrollTop()).toBeGreaterThan(800);
  expect(renderer.getScrollTop()).toBeLessThan(1200);
  advance(100);
  expect(renderer.getScrollTop()).toBe(1200);
});

it('jumps distant edges and nearby unmounted edges immediately', async () => {
  await renderer.goToSectionEdge(2, 'end');
  expect(renderer.getScrollTop()).toBe(5200);
  state.mounted.delete(1);
  renderer.setScrollTop(1800);
  await renderer.goToSectionEdge(1, 'start');
  expect(renderer.getScrollTop()).toBe(2000);
});

it('snaps page and nearby edges under reduced motion', async () => {
  state.reduced = true;
  renderer.page(1);
  expect(renderer.getScrollTop()).toBe(730);
  await renderer.goToSectionEdge(0, 'start');
  expect(renderer.getScrollTop()).toBe(0);
  expect(frames.size).toBe(0);
});

it.each(['wheel', 'pointerdown'])('cancels a page on %s without a later correction', (event) => {
  renderer.page(1);
  advance(50);
  const at = renderer.getScrollTop();
  renderer.scrollElement!.dispatchEvent(new Event(event));
  advance(1000);
  expect(renderer.getScrollTop()).toBe(at);
});

it('keeps external anchoring corrections instead of writing stale absolute animation positions', () => {
  renderer.setScrollTop(1000);
  renderer.page(1);
  advance(50);
  renderer.scrollElement!.scrollTop += 300;
  advance(150);
  expect(renderer.getScrollTop()).toBe(2030);
});
