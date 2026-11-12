// @vitest-environment jsdom
/**
 * PaginatorRenderer behaviour in jsdom (ADR-004, ADR-005). jsdom has no layout, so the two
 * layout-dependent modules are replaced by a deterministic model: a column holds
 * floor(textW / fontSize) × floor(textH / lineHeight) characters of the section text (real DOM
 * documents, real Range / text offsets). The strip maths (stripMath), the motion (stripMotion over
 * input/scrollAnimation), navigation, locators (flow/flowAnchor), the sticky target, the
 * narrow-window fallback, page steps, held keys via the real SmoothScroller, wheel, clicks and
 * auto-scroll are the real code. Real-layout checks (column count at 3440 px, caret hit-testing,
 * how the slide looks) need the app: see ADR-004/ADR-005 "Verification".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locator } from '@contract/types';
import defaults from '../../../contract/settings.defaults.json';
import type { BookSource } from '../book/BookSource';
import { AutoScroller } from '../input/autoScroller';
import { SmoothScroller } from '../input/smoothScroller';
import { compileStyle } from '../style/compileStyle';
import { DEFAULT_READING_STYLE } from '../style/readingStyle';
import type { CompiledStyle } from '../style/types';
import type { SectionFrame } from './flow/sectionFrame';
import type { SectionText } from './flow/sectionText';
import type { PagedGeometry } from './paged/pagedMath';
import { PaginatorRenderer, type PaginatorRendererOptions } from './PaginatorRenderer';
import type { RendererEventMap } from './Renderer';

interface FakeFrame {
  index: number;
  ready: true;
  doc: Document;
  iframe: HTMLIFrameElement;
  text(): SectionText;
}

const state = vi.hoisted(() => ({
  width: 1600,
  height: 1000,
  style: null as unknown as CompiledStyle,
  docs: [] as Document[],
  texts: new Map<Document, SectionText>(),
  places: [] as Array<{ base: number; x: number }>,
  /** Sections the neighbour preloading never mounts (only a navigation does). */
  lazy: new Set<number>(),
  rectCalls: [] as Array<{ frameAt: (i: number) => unknown; viewport: unknown; pitch: unknown }>,
  frames: null as unknown as {
    geometry: PagedGeometry;
    root: HTMLDivElement;
    clip: HTMLDivElement;
    placed: { base: number; x: number };
    columns(i: number): number;
    mountedIndices(): number[];
  },
  cpc(g: Pick<PagedGeometry, 'textW' | 'textH'>): number {
    const s = state.style;
    return Math.max(1, Math.floor(g.textW / s.fontSizePx)) * Math.max(1, Math.floor(g.textH / s.lineHeightPx));
  },
}));

vi.mock('./paged/pagedAnchor', async () => {
  const { offsetOfBoundary, rangeAtOffset } = await import('./flow/sectionText');
  return {
    columnOfTarget(t: Range | Element): number | null {
      const doc = 'nodeType' in t ? t.ownerDocument : t.startContainer.ownerDocument;
      const text = doc ? state.texts.get(doc) : undefined;
      if (!text) return null;
      const off = 'nodeType' in t ? offsetOfBoundary(text, t, 0) : offsetOfBoundary(text, t.startContainer, t.startOffset);
      return Math.floor(off / state.cpc(state.frames.geometry));
    },
    firstVisibleInColumn(doc: Document, t: SectionText, col: number, g: PagedGeometry): Range {
      return rangeAtOffset(doc, t, Math.min(t.total, col * state.cpc(g)));
    },
  };
});

vi.mock('./locatorRect', () => ({
  locatorViewportRect(_l: unknown, frameAt: (i: number) => unknown, viewport: unknown, _b: unknown, pitch: unknown) {
    state.rectCalls.push({ frameAt, viewport, pitch });
    return null;
  },
}));

vi.mock('./paged/pagedFrames', async () => {
  const { pagedGeometry } = await import('./paged/pagedMath');
  const { stripBlock } = await import('./paged/stripMath');
  const { buildSectionText } = await import('./flow/sectionText');
  return {
    PagedFrames: class {
      root = document.createElement('div');
      clip = document.createElement('div');
      #g!: PagedGeometry;
      #placed = { base: -1, x: 0 };
      #mounted = new Map<number, FakeFrame>();
      #n: number;
      #colsFor: (w: number) => 1 | 2;
      constructor(host: HTMLElement, book: BookSource, style: CompiledStyle, gap: number, colsFor: (w: number) => 1 | 2) {
        this.#colsFor = colsFor;
        this.#n = book.sections.length;
        Object.defineProperties(this.root, {
          clientWidth: { get: () => state.width },
          clientHeight: { get: () => state.height },
        });
        this.root.getBoundingClientRect = () => ({ left: 0, top: 0, width: state.width, height: state.height }) as DOMRect;
        this.root.append(this.clip);
        host.append(this.root);
        state.frames = this as never;
        this.applyStyle(style, gap);
      }
      get geometry() {
        return this.#g;
      }
      get placed() {
        return { ...this.#placed };
      }
      columns(i: number) {
        if (!this.#mounted.has(i)) return 1;
        return Math.max(1, Math.ceil(state.texts.get(state.docs[i]!)!.total / state.cpc(this.#g)));
      }
      block(base: number) {
        return stripBlock(base, (i) => this.#mounted.has(i), (i) => this.columns(i), this.#n);
      }
      frameAt(i: number) {
        return this.#mounted.get(i) ?? null;
      }
      mountedIndices() {
        return [...this.#mounted.keys()].sort((a, b) => a - b);
      }
      applyStyle(style: CompiledStyle, gapPx: number) {
        state.style = style;
        const cols = this.#colsFor(state.width);
        this.#g = pagedGeometry({
          viewportW: state.width,
          viewportH: state.height,
          gapPx,
          marginXPx: style.marginXPx,
          marginYPx: style.marginYPx,
          maxLineWidthPx: style.maxLineWidthPx,
          cols,
        });
      }
      place(base: number, x: number) {
        this.#placed = { base, x };
        state.places.push({ base, x });
      }
      #make(i: number): FakeFrame {
        const doc = state.docs[i]!;
        if (!state.texts.has(doc)) state.texts.set(doc, buildSectionText(doc));
        return { index: i, ready: true, doc, iframe: document.createElement('iframe'), text: () => state.texts.get(doc)! };
      }
      ensureMounted(i: number) {
        if (i < 0 || i >= this.#n) return Promise.resolve(null);
        if (!this.#mounted.has(i)) this.#mounted.set(i, this.#make(i));
        return Promise.resolve(this.#mounted.get(i)!);
      }
      reconcile(keep: number[], pinned: ReadonlySet<number>) {
        for (const i of [...this.#mounted.keys()]) if (!keep.includes(i) && !pinned.has(i)) this.#mounted.delete(i);
        for (const i of keep)
          if (i >= 0 && i < this.#n && !this.#mounted.has(i) && !state.lazy.has(i)) this.#mounted.set(i, this.#make(i));
      }
      remeasure() {
        return false;
      }
      destroy() {
        this.root.remove();
      }
    },
  };
});

/** Deterministic, non-repeating section text (so snippet re-anchoring finds the one true match). */
function makeDoc(i: number, paragraphs: number): Document {
  const doc = document.implementation.createHTMLDocument(`s${i}`);
  for (let p = 0; p < paragraphs; p++) {
    const el = doc.createElement('p');
    el.textContent = Array.from({ length: 60 }, (_, k) => `s${i}p${p}w${k}`).join(' ');
    doc.body.append(el);
  }
  return doc;
}

const book = (): BookSource =>
  ({
    format: 'epub',
    sections: state.docs.map((d) => ({ id: d.title, size: d.body.textContent!.length })),
    resolveHref: () => null,
  }) as unknown as BookSource;

let rafQueue: Map<number, FrameRequestCallback>;
let rafId: number;
let now: number;
let reduced: boolean;
const flushRaf = (): void => {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of cbs) cb(now);
};
/** One 60 Hz frame for everything on the frame clock (strip motion, smoothScroller, auto-scroll). */
const frame = (ms = 16): void => {
  now += ms;
  flushRaf();
};
/** Run frames until no motion is pending; returns the elapsed ms. */
const settle = (): number => {
  const t0 = now;
  for (let k = 0; k < 200 && rafQueue.size > 0; k++) frame();
  return now - t0;
};

const style = (size = DEFAULT_READING_STYLE.font.size): CompiledStyle =>
  compileStyle({ ...DEFAULT_READING_STYLE, font: { ...DEFAULT_READING_STYLE.font, size } });

let live: PaginatorRenderer[] = [];
async function mount(pagesPerView: 1 | 2, at?: Locator, css = style(), minSpreadWidthPx?: number, extra: PaginatorRendererOptions = {}) {
  const r = new PaginatorRenderer({ pagesPerView, minSpreadWidthPx, reducedMotion: () => reduced, ...extra });
  live.push(r);
  const host = document.createElement('div');
  document.body.append(host);
  const spreads: Array<RendererEventMap['spread']> = [];
  r.on('spread', (e) => spreads.push(e));
  await r.mount(host, book(), css, at);
  return { r, spreads };
}

const pos = (r: PaginatorRenderer) => {
  const d = r.debugStats()!;
  return { index: d.index, column: d.column };
};
const pitch = (): number => state.frames.geometry.pitch;
/** Visual position: section and px offset of the view's left edge. */
const visual = () => state.frames.placed;

beforeEach(() => {
  state.width = 1600;
  state.height = 1000;
  state.places = [];
  state.lazy = new Set();
  state.rectCalls = [];
  state.texts = new Map();
  state.docs = [makeDoc(0, 8), makeDoc(1, 20), makeDoc(2, 3), makeDoc(3, 20)];
  rafQueue = new Map();
  rafId = 0;
  now = 1000;
  reduced = false;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (n: number) => rafQueue.delete(n));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }) as DOMRect;
  }
});

afterEach(() => {
  for (const r of live) r.destroy();
  live = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('page turn slide, paged + 1 (t20u #5)', () => {
  it('next = content slides left: visible after one frame, ease-out, done within 200 ms, relocate at rest', async () => {
    const { r } = await mount(1);
    const turns: string[] = [];
    r.on('relocate', (e) => turns.push(e.reason));
    state.places = [];
    r.page(1);
    expect(pos(r)).toEqual({ index: 0, column: 1 }); // the locator target is known at once
    frame();
    const first = visual().x;
    expect(first).toBeGreaterThan(0.2 * pitch()); // next page painted in the first frame (<= 16 ms)
    expect(first).toBeLessThan(pitch());
    expect(turns).toEqual([]);
    expect(settle() + 16).toBeLessThanOrEqual(200);
    expect(visual()).toEqual({ base: 0, x: pitch() });
    const xs = state.places.map((p) => p.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!); // strip moves left only
    expect(turns).toEqual(['scroll']);
  });

  it('prev = content slides right', async () => {
    const { r } = await mount(1);
    r.page(1);
    settle();
    state.places = [];
    r.page(-1);
    frame();
    expect(visual().x).toBeLessThan(pitch());
    expect(visual().x).toBeGreaterThan(0);
    settle();
    expect(visual()).toEqual({ base: 0, x: 0 });
  });

  it('rapid turns never queue: a new turn finishes the running one instantly and starts the next', async () => {
    const { r } = await mount(1);
    r.page(1);
    frame();
    r.page(1);
    expect(visual().x).toBe(pitch()); // turn 1 completed at once
    r.page(1);
    expect(visual().x).toBe(2 * pitch());
    const t = settle();
    expect(t).toBeLessThanOrEqual(200); // only the last turn still animates
    expect(pos(r)).toEqual({ index: 0, column: 3 });
  });

  it('reduced motion: instant turn, synchronous relocate, no animation frame, no timer', async () => {
    reduced = true;
    const { r } = await mount(1);
    const turns: string[] = [];
    r.on('relocate', (e) => turns.push(e.reason));
    const timers = vi.getTimerCount();
    r.page(1);
    expect(visual().x).toBe(pitch());
    expect(turns).toEqual(['scroll']);
    expect(rafQueue.size).toBe(0);
    expect(vi.getTimerCount()).toBe(timers);
  });

  it('defaults to the OS prefers-reduced-motion setting', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const r = new PaginatorRenderer({ pagesPerView: 1 });
    live.push(r);
    const host = document.createElement('div');
    document.body.append(host);
    await r.mount(host, book(), style());
    r.page(1);
    expect(rafQueue.size).toBe(0);
    expect(visual().x).toBe(pitch());
  });

  it('crosses chapters with the same slide (neighbours are preloaded), both directions', async () => {
    const { r } = await mount(1);
    const sections: number[] = [];
    r.on('section', (e) => sections.push(e.index));
    const last = state.frames.columns(0) - 1;
    for (let k = 0; k < last; k++) {
      r.page(1);
      settle();
    }
    expect(pos(r)).toEqual({ index: 0, column: last });
    r.page(1);
    expect(rafQueue.size).toBeGreaterThan(0); // animated, no navigation
    settle();
    expect(pos(r)).toEqual({ index: 1, column: 0 });
    expect(visual()).toEqual({ base: 1, x: 0 });
    r.page(-1);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: last });
    expect(sections).toEqual([1, 0]);
    expect(r.getSectionIndex()).toBe(0);
  });

  it('G-PM2: a locator with progress 1 restores to the last page of the book', async () => {
    const { r } = await mount(2, {
      sectionIndex: 3,
      cfi: null,
      charOffset: 5,
      globalCharOffset: null,
      progress: 1,
      snippet: 'x',
    });
    expect(r.isAtEnd()).toBe(true);
    expect(r.getLocator().progress).toBe(1);
  });

  it('stops at the book edges', async () => {
    const { r } = await mount(1);
    r.page(-1);
    expect(rafQueue.size).toBe(0);
    expect(pos(r)).toEqual({ index: 0, column: 0 });
    await r.goToSectionEdge(3, 'end');
    const end = pos(r);
    expect(r.isAtEnd()).toBe(true);
    r.page(1);
    settle();
    expect(pos(r)).toEqual(end);
  });

  it('scroll.down/up via the smoothScroller turn exactly one page per press', async () => {
    const { r } = await mount(1);
    const scroller = new SmoothScroller(r);
    scroller.press(1);
    for (let k = 0; k < 30; k++) frame();
    scroller.release(1);
    settle();
    expect(pos(r).column).toBe(1); // held for 480 ms: still one page
    scroller.press(-1);
    frame();
    scroller.release(-1);
    settle();
    expect(pos(r).column).toBe(0);
    expect(r.holdMove(10)).toBe(false); // paged + 1: no continuous travel after the press
  });

  it('paged + 1: a short tap (press, release within 120 ms) turns exactly one page, not two', async () => {
    const { r } = await mount(1);
    const scroller = new SmoothScroller(r);
    for (const dir of [1, 1, -1] as const) {
      const before = pos(r).column;
      scroller.press(dir);
      if (dir === 1 && before === 0) now += 30; // keyup before the first frame
      else frame();
      scroller.release(dir);
      settle();
      expect(pos(r).column).toBe(before + dir);
    }
    // Held long, then released: the release glide must not add a page either.
    scroller.press(1);
    for (let k = 0; k < 30; k++) frame();
    scroller.release(1);
    settle();
    expect(pos(r).column).toBe(2);
  });

  it('click zones: left third back, right third forward, middle nothing; off in scroll flow', async () => {
    const { r } = await mount(1);
    const click = (x: number) =>
      r.scrollElement!.dispatchEvent(new MouseEvent('click', { clientX: x, button: 0, bubbles: true }));
    click(1500);
    settle();
    expect(pos(r).column).toBe(1);
    click(800);
    settle();
    expect(pos(r).column).toBe(1);
    click(100);
    settle();
    expect(pos(r).column).toBe(0);
    const { r: strip } = await mount(2, undefined, style(), undefined, { clickZones: false });
    strip.scrollElement!.dispatchEvent(new MouseEvent('click', { clientX: 1500, button: 0, bubbles: true }));
    expect(pos(strip).column).toBe(0);
  });

  it('wheel turns one page per gesture', async () => {
    const { r } = await mount(1);
    const wheel = (dy: number) => r.scrollElement!.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }));
    wheel(100);
    now += 30;
    wheel(100);
    settle();
    expect(pos(r).column).toBe(1);
    now += 500;
    wheel(100);
    settle();
    expect(pos(r).column).toBe(2);
  });
});

describe('two-page filmstrip (t20u #6, ADR-005)', () => {
  it('advance = ONE page: the left page slides out, the right page moves to the left slot', async () => {
    const { r } = await mount(2);
    expect(r.getEffectivePagesPerView()).toBe(2);
    r.page(1);
    frame();
    expect(visual().x).toBeGreaterThan(0);
    expect(visual().x).toBeLessThan(pitch());
    const t = settle();
    expect(t).toBeLessThanOrEqual(200);
    expect(pos(r)).toEqual({ index: 0, column: 1 }); // the old right page (column 1) is now on the left
    expect(visual().x).toBe(pitch()); // the strip moved by exactly one page pitch
    // The locator is the first character of the new left page.
    expect(r.getLocator().charOffset).toBe(1 * state.cpc(state.frames.geometry));
  });

  it('back is the reverse', async () => {
    const { r } = await mount(2);
    r.page(1);
    r.page(1);
    settle();
    state.places = [];
    r.page(-1);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: 1 });
    const xs = state.places.map((p) => p.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThanOrEqual(xs[i - 1]!);
  });

  it('a chapter end and the next chapter sit side by side; every step is still one page', async () => {
    const { r } = await mount(2);
    const sections: number[] = [];
    r.on('section', (e) => sections.push(e.index));
    const last = state.frames.columns(0) - 1;
    for (let k = 0; k < last; k++) r.page(1);
    settle();
    // Left: chapter 0's last page; right: chapter 1's first page (one strip, no blank page).
    expect(pos(r)).toEqual({ index: 0, column: last });
    r.getLocatorRect({ sectionIndex: 1, charOffset: 0, cfi: null, globalCharOffset: null, progress: 0, snippet: '' });
    const call = state.rectCalls.at(-1)!;
    expect(call.frameAt(0)).not.toBeNull();
    expect(call.frameAt(1)).not.toBeNull(); // marks on the right page (next chapter) resolve too
    expect(call.viewport).toBe(state.frames.clip);
    expect(call.pitch).toBe(pitch());
    r.page(1);
    settle();
    expect(pos(r)).toEqual({ index: 1, column: 0 });
    expect(sections).toEqual([1]);
    r.page(-1);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: last });
  });

  it('held arrow key moves continuously and settles on a page boundary', async () => {
    const { r } = await mount(2);
    const scroller = new SmoothScroller(r);
    const relocates: number[] = [];
    r.on('relocate', (e) => relocates.push(e.locator.charOffset));
    scroller.press(1);
    let last = -1;
    let stalls = 0;
    const travel: number[] = [];
    for (let k = 0; k < 75; k++) {
      frame();
      const v = visual();
      const x = v.x + (v.base === 0 ? 0 : 1e9); // monotonic check within section 0 (long enough)
      if (x <= last + 0.01) stalls++;
      last = x;
      travel.push(v.x);
    }
    expect(visual().base).toBe(0);
    expect(stalls).toBe(0); // moved every single frame: continuous, no step-pause-step
    expect(visual().x).toBeGreaterThan(1.2 * pitch()); // more than one page in 1.2 s
    expect(relocates).toEqual([]); // nothing reported mid-motion
    scroller.release(1);
    settle();
    const x = visual().x;
    expect(Math.abs(x / pitch() - Math.round(x / pitch()))).toBeLessThan(1e-9); // on a page boundary
    expect(relocates.length).toBe(1);
    expect(pos(r).column).toBe(Math.round(x / pitch()));
  });

  it('a held key keeps going across a section boundary that was not loaded yet (#20)', async () => {
    state.lazy = new Set([1]);
    const { r } = await mount(2);
    await r.goToSectionEdge(0, 'end');
    r.page(1); // left page = section 0's last page; the next step needs section 1
    settle();
    expect(pos(r)).toEqual({ index: 0, column: state.frames.columns(0) - 1 });
    expect(state.frames.mountedIndices()).not.toContain(1);
    const scroller = new SmoothScroller(r);
    scroller.press(1); // the first page step needs section 1: a navigation
    await Promise.resolve();
    await Promise.resolve();
    expect(visual().base).toBe(1);
    for (let k = 0; k < 40; k++) frame();
    expect(visual().base).toBe(1);
    expect(visual().x).toBeGreaterThan(pitch() / 2); // still travelling inside section 1
    expect(rafQueue.size).toBeGreaterThan(0);
    scroller.release(1);
    settle();
    expect(visual().x % pitch()).toBe(0);
  });

  it('a short tap of the arrow key moves exactly one page', async () => {
    const { r } = await mount(2);
    const scroller = new SmoothScroller(r);
    scroller.press(1);
    frame();
    frame();
    scroller.release(1);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: 1 });
    expect(visual().x).toBe(pitch());
    scroller.press(-1);
    frame();
    scroller.release(-1);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: 0 });
  });

  it('rapid presses: every press is a page, without lag', async () => {
    const { r } = await mount(2);
    const scroller = new SmoothScroller(r);
    for (let k = 0; k < 3; k++) {
      scroller.press(1);
      frame();
      scroller.release(1);
      frame();
    }
    expect(settle()).toBeLessThanOrEqual(200);
    expect(pos(r)).toEqual({ index: 0, column: 3 });
  });

  it('reduced motion: instant steps, a held key is one page per press', async () => {
    reduced = true;
    const { r } = await mount(2);
    const scroller = new SmoothScroller(r, undefined, undefined, true);
    scroller.press(1);
    expect(visual().x).toBe(pitch());
    for (let k = 0; k < 30; k++) frame();
    scroller.release(1);
    expect(rafQueue.size).toBe(0);
    expect(pos(r)).toEqual({ index: 0, column: 1 });
    r.page(1);
    expect(visual().x).toBe(2 * pitch());
  });

  it('wheel: one notch = one page; a continuous stream moves continuously and settles on a page', async () => {
    const { r } = await mount(2);
    const wheel = (dy: number) => r.scrollElement!.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }));
    wheel(100);
    vi.advanceTimersByTime(200);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: 1 });
    // Touchpad: 40 events of 30 px, one per frame.
    for (let k = 0; k < 40; k++) {
      wheel(30);
      frame();
      vi.advanceTimersByTime(16);
    }
    expect(visual().x).toBeGreaterThan(2 * pitch());
    vi.advanceTimersByTime(200);
    settle();
    const x = visual().x;
    expect(x % pitch()).toBe(0);
    expect(pos(r).column).toBeGreaterThanOrEqual(2);
  });

  it('mouse-wheel notches at a normal cadence are one page each (no stall inside a gesture)', async () => {
    const { r } = await mount(2);
    await r.goToSectionEdge(1, 'start'); // a long chapter
    const wheel = (dy: number) => r.scrollElement!.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }));
    // 5 notches, 120 ms apart (well inside the 160 ms quiet time), 100 px and 33 px (1-line) sizes.
    for (const dy of [100, 100, 33, 100, 100]) {
      wheel(dy);
      for (let t = 0; t < 120; t += 16) {
        frame();
        vi.advanceTimersByTime(16);
      }
    }
    vi.advanceTimersByTime(200);
    settle();
    expect(pos(r)).toEqual({ index: 1, column: 5 });
    expect(visual()).toEqual({ base: 1, x: 5 * pitch() });
    // Back: line-mode deltas are discrete too.
    r.scrollElement!.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true }));
    vi.advanceTimersByTime(200);
    settle();
    expect(pos(r).column).toBe(4);
  });

  it('a short touchpad swipe (small deltas every frame) moves exactly one page', async () => {
    const { r } = await mount(2);
    const wheel = (dy: number) => r.scrollElement!.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }));
    for (const dy of [4, 9, 14, 18, 14, 9, 5, 2]) {
      wheel(dy);
      frame();
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(200);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: 1 });
    expect(visual().x).toBe(pitch());
  });

  it('a held key never settles back against its travel', async () => {
    const { r } = await mount(2);
    const scroller = new SmoothScroller(r);
    for (const ms of [140, 260, 400, 530, 700]) {
      state.places = [];
      scroller.press(1);
      for (let t = 0; t < ms; t += 16) frame();
      scroller.release(1);
      settle();
      const xs = state.places.filter((p) => p.base === state.places[0]!.base).map((p) => p.x);
      for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9);
      expect(visual().x % pitch()).toBe(0);
    }
    state.places = [];
    scroller.press(-1);
    for (let t = 0; t < 300; t += 16) frame();
    scroller.release(-1);
    settle();
    const back = state.places.filter((p) => p.base === state.places[0]!.base).map((p) => p.x);
    for (let i = 1; i < back.length; i++) expect(back[i]!).toBeLessThanOrEqual(back[i - 1]! + 1e-9);
  });

  it('auto-scroll advances one page every viewport-height of travel (scroll flow too)', async () => {
    const { r } = await mount(2);
    const auto = new AutoScroller(r, { ...defaults.autoscroll, speed: 100 }, false); // flow=scroll: paged=false
    auto.toggle();
    const period = (1000 * state.height) / 100;
    for (let t = 0; t < 2.5 * period; t += 16) frame();
    auto.stop();
    settle();
    expect(pos(r)).toEqual({ index: 0, column: 2 });
  });

  it('Home/End and Ctrl+Home/End show the first/last pages of a section or the book', async () => {
    const { r } = await mount(2);
    await r.goToSectionEdge(1, 'end');
    expect(pos(r)).toEqual({ index: 1, column: state.frames.columns(1) - 2 }); // last page on the right
    await r.goToSectionEdge(1, 'start');
    expect(pos(r)).toEqual({ index: 1, column: 0 });
    await r.goToSectionEdge(3, 'end');
    expect(r.isAtEnd()).toBe(true);
    expect(r.holdStart(1)).toBe(true);
    expect(r.holdMove(10)).toBe(false); // a held key stops at the book end
    r.holdEnd();
    settle();
    r.page(1);
    expect(rafQueue.size).toBe(0);
    await r.goToSectionEdge(0, 'start');
    expect(pos(r)).toEqual({ index: 0, column: 0 });
    expect(r.holdStart(-1)).toBe(true);
    expect(r.holdMove(-10)).toBe(false); // ...and at the book start
    r.holdEnd();
    settle();
    expect(r.holdStart(1)).toBe(true);
    expect(r.holdMove(10)).toBe(true);
    r.holdEnd();
  });
});

describe('narrow-window fallback (FR-LM-3, LM-04, LM-07)', () => {
  const resize = (r: PaginatorRenderer, w: number) => {
    state.width = w;
    r.resize();
    flushRaf();
  };

  it('two pages show one page below minSpreadWidthPx and two again when wide', async () => {
    const { r, spreads } = await mount(2);
    expect(r.getEffectivePagesPerView()).toBe(2);
    resize(r, 900);
    expect(r.getEffectivePagesPerView()).toBe(1);
    expect(state.frames.geometry.cols).toBe(1);
    resize(r, 999);
    expect(r.getEffectivePagesPerView()).toBe(1);
    resize(r, 1000);
    expect(r.getEffectivePagesPerView()).toBe(2);
    expect(spreads).toEqual([
      { pagesPerView: 2, requested: 2 },
      { pagesPerView: 1, requested: 2 },
      { pagesPerView: 2, requested: 2 },
    ]);
  });

  it('the one-page fallback still steps one page with the slide', async () => {
    state.width = 800;
    const { r } = await mount(2);
    expect(r.getEffectivePagesPerView()).toBe(1);
    r.page(1);
    frame();
    expect(visual().x).toBeGreaterThan(0);
    settle();
    expect(pos(r)).toEqual({ index: 0, column: 1 });
  });

  it('starts in one page when mounted narrow, and honours a runtime minSpreadWidthPx change', async () => {
    state.width = 800;
    const { r, spreads } = await mount(2);
    expect(spreads).toEqual([{ pagesPerView: 1, requested: 2 }]);
    resize(r, 1600);
    expect(r.getEffectivePagesPerView()).toBe(2);
    r.setMinSpreadWidth(2000);
    expect(r.getEffectivePagesPerView()).toBe(1);
    r.setMinSpreadWidth(600);
    expect(r.getEffectivePagesPerView()).toBe(2);
  });

  it('a one-page profile never shows two pages, even at 3440 px', async () => {
    state.width = 3440;
    const { r, spreads } = await mount(1, undefined, style(), 600);
    expect(state.frames.geometry.cols).toBe(1);
    expect(state.frames.geometry.frameW).toBe(state.frames.geometry.textW);
    resize(r, 5000);
    expect(r.getEffectivePagesPerView()).toBe(1);
    expect(spreads).toEqual([{ pagesPerView: 1, requested: 1 }]);
  });

  it('keeps the reading position across the fallback and back', async () => {
    const { r } = await mount(2);
    r.page(1);
    r.page(1);
    settle();
    const before = r.getLocator();
    resize(r, 800);
    expect(r.getLocator()).toMatchObject({ sectionIndex: before.sectionIndex, charOffset: before.charOffset });
    resize(r, 1600);
    expect(r.getLocator()).toMatchObject({ sectionIndex: before.sectionIndex, charOffset: before.charOffset });
    expect(pos(r).column).toBe(2);
  });
});

describe('window resize: full screen, maximize/restore (t20u #2)', () => {
  const size = (r: PaginatorRenderer, w: number, h: number) => {
    state.width = w;
    state.height = h;
    r.resize();
    flushRaf();
  };
  const SEQ: Array<[number, number]> = [
    [1920, 1080],
    [1280, 720],
    [1920, 1080],
    [1280, 720],
  ];

  it.each([1, 2] as const)('%i page(s): 1280x720 -> 1920x1080 -> 1280x720 keeps the locator exactly', async (pages) => {
    state.width = 1280;
    state.height = 720;
    const { r } = await mount(pages);
    await r.goTo({ sectionIndex: 1, charOffset: 3333, cfi: null, globalCharOffset: null, progress: 0, snippet: '' });
    r.page(1);
    r.page(1);
    settle();
    const before = r.getLocator();
    const reasons: string[] = [];
    r.on('relocate', (e) => reasons.push(e.reason));
    for (const [w, h] of SEQ) {
      size(r, w, h);
      expect(r.getLocator()).toMatchObject({ sectionIndex: before.sectionIndex, charOffset: before.charOffset });
      expect(r.debugStats()!.sticky).toBe(true); // the character is on a shown page
      expect(visual().x % pitch()).toBe(0); // resting on a page boundary of the new geometry
      expect(r.getEffectivePagesPerView()).toBe(pages);
    }
    vi.advanceTimersByTime(250);
    expect(reasons).toEqual([]); // same position: no new relocate after the burst
    // Steps still work after the round trip, in the new geometry.
    r.page(1);
    settle();
    expect(pos(r).column).toBe(r.debugStats()!.column);
    expect(r.getLocator().charOffset).toBe(pos(r).column * state.cpc(state.frames.geometry));
  });

  it.each([1, 2] as const)('%i page(s): a resize during a slide lands on the slide target, then round-trips', async (pages) => {
    state.width = 1280;
    state.height = 720;
    const { r } = await mount(pages);
    r.page(1);
    r.page(1);
    settle();
    r.page(1);
    frame(); // mid-slide
    expect(r.debugStats()!.moving).toBe(true);
    const target = r.getLocator(); // the page the slide is going to
    size(r, 1920, 1080);
    expect(r.debugStats()!.moving).toBe(false);
    expect(rafQueue.size).toBe(0); // no stale animation continues in the old geometry
    expect(r.getLocator().charOffset).toBe(target.charOffset);
    size(r, 1280, 720);
    expect(r.getLocator().charOffset).toBe(target.charOffset);
    expect(pos(r)).toEqual({ index: 0, column: 3 });
  });

  it('a resize while a key is held keeps the hold going and still settles on a page', async () => {
    state.width = 1280;
    state.height = 720;
    const { r } = await mount(2);
    const scroller = new SmoothScroller(r);
    scroller.press(1);
    for (let k = 0; k < 20; k++) frame();
    size(r, 1920, 1080);
    const after = visual().x;
    for (let k = 0; k < 20; k++) frame();
    expect(visual().x).toBeGreaterThan(after); // still moving with the held key
    scroller.release(1);
    settle();
    expect(visual().x % pitch()).toBe(0);
  });

  it('maximize/restore across the narrow fallback (two pages <-> one page) keeps the locator', async () => {
    state.width = 1280;
    state.height = 720;
    const { r, spreads } = await mount(2);
    for (let k = 0; k < 3; k++) r.page(1);
    settle();
    const before = r.getLocator();
    for (const [w, h] of [[900, 700], [1920, 1080], [800, 600], [1280, 720]] as Array<[number, number]>) {
      size(r, w, h);
      expect(r.getLocator().charOffset).toBe(before.charOffset);
    }
    expect(spreads.map((s) => s.pagesPerView)).toEqual([2, 1, 2, 1, 2]);
  });
});

describe('locator preservation (FR-LM-4, LM-05)', () => {
  it('drift = 0 characters across 60 random switches (pages, width, font, remount), also mid-slide', async () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    let pages: 1 | 2 = 1;
    let font = 20;
    let { r } = await mount(pages, undefined, style(font));
    await r.goTo({ sectionIndex: 1, charOffset: 4321, cfi: null, globalCharOffset: null, progress: 0, snippet: '' });
    let maxDrift = 0;
    for (let k = 0; k < 60; k++) {
      for (let t = rand(4); t > 0; t--) r.page(rand(3) === 0 ? -1 : 1);
      if (rand(2) === 0) settle(); // else: switch while the slide is still running
      else frame();
      const before = r.getLocator();
      const kind = rand(3);
      if (kind === 0) {
        // ReaderView.replaceLayout: getLocator → destroy → new renderer mounted at it (M / D keys).
        pages = pages === 1 ? 2 : 1;
        r.destroy();
        ({ r } = await mount(pages, before, style(font)));
      } else if (kind === 1) {
        state.width = [800, 1200, 1600, 2560, 3440][rand(5)]!;
        r.resize();
        flushRaf();
      } else {
        font = [16, 18, 20, 24, 28][rand(5)]!;
        await r.setStyle(style(font));
      }
      const after = r.getLocator();
      expect(after.sectionIndex).toBe(before.sectionIndex);
      maxDrift = Math.max(maxDrift, Math.abs(after.charOffset - before.charOffset));
      // The target character is on a page that is shown.
      expect(r.debugStats()!.sticky).toBe(true);
      expect(r.debugStats()!.moving).toBe(false);
    }
    expect(maxDrift).toBe(0);
  });

  it('goTo puts the target on the left page and reports it exactly', async () => {
    const { r } = await mount(2);
    await r.goTo({ sectionIndex: 3, charOffset: 5000, cfi: null, globalCharOffset: null, progress: 0, snippet: '' });
    const g = state.frames.geometry;
    expect(pos(r)).toEqual({ index: 3, column: Math.floor(5000 / state.cpc(g)) });
    expect(r.getLocator().charOffset).toBe(5000);
    r.page(1);
    settle();
    // After a step the locator is the first character of the new left page.
    expect(r.getLocator().charOffset).toBe(pos(r).column * state.cpc(g));
  });
});

it('restores an unmounted scroll section by progress instead of treating its placeholder offset as book start', async () => {
  const placeholder: Locator = { sectionIndex: 0, charOffset: 0, cfi: null, globalCharOffset: null, progress: 0.08, snippet: '' };
  const { r } = await mount(1, placeholder);
  expect(r.getLocator().charOffset).toBeGreaterThan(0);
  expect(r.getLocator().progress).toBeCloseTo(placeholder.progress, 2);
  const at = r.getLocator();
  const { r: two } = await mount(2, at);
  expect(two.getLocator().charOffset).toBe(at.charOffset);
  const { r: one } = await mount(1, two.getLocator());
  expect(one.getLocator().charOffset).toBe(at.charOffset);
});

// Keep the SectionFrame type import used (the fake implements the subset the renderer reads).
export type { SectionFrame };

it('takes page gap from CompiledStyle on mount and live style changes', async () => {
  const { r } = await mount(2, undefined, { ...style(), pageGapPx: 32 });
  expect(state.frames.geometry.gapPx).toBe(32);
  await r.setStyle({ ...style(), pageGapPx: 64 });
  expect(state.frames.geometry.gapPx).toBe(64);
});
