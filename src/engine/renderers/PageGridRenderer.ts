import { locatorViewportRect } from './locatorRect';
/**
 * PageGridRenderer (PRD FR-LM-2, §10.4 step 5; ADR-002): scroll flow, two pages per view, OPT-IN
 * only (FR-LM-0). Rows of two pages, each page exactly one viewport tall, stack vertically and scroll
 * continuously across sections (Word's multi-page view); PgDn moves exactly one row. Each section
 * starts on a new row. Candidate A: one iframe per section whose root is a wrapped multicol
 * (`column-height` + `column-wrap: wrap`), so sections are whole rows tall and the flow machinery
 * (slots, estimation, anchoring, key forwarding, locators) applies. Check `detectGridSupport()`
 * first (createRenderer does). Same scroll-target API as FlowRenderer for the smoothScroller.
 */
import type { Locator } from '@contract/types';
import type { BookSource } from '../book/BookSource';
import { ScrollAnimation } from '../input/scrollAnimation';
import type { CompiledStyle } from '../style/types';
import { forwardCtrlWheel, forwardKey } from './flow/eventForward';
import {
  hrefPlacement,
  locatorAttempts,
  locatorOf,
  textAnchorOf,
  type Anchor,
  type LocatorBridge,
  type Placement,
} from './flow/flowAnchor';
import { clamp, ScrollVelocity } from './flow/flowMath';
import { ScrollPosition } from './flow/scrollPosition';
import type { SectionFrame } from './flow/sectionFrame';
import { captureGridAnchor, gridRestoreTarget, liveRange, rowAligned, stickyAnchor } from './grid/gridAnchor';
import { DEFAULT_MIN_SPREAD_WIDTH_PX, gridPageStep, sectionEdgeY } from './grid/gridMath';
import {
  listenScroller,
  mountWindow,
  pageGapOf,
  PinSet,
  prefersReducedMotion,
  RendererEmitter,
  resolveLink,
  type PageGridDebugStats,
} from './grid/gridParts';
import { GridSlots } from './grid/gridSlots';
import type { GoToTarget, RelocateReason, Renderer, RendererEventMap, RendererEventName } from './Renderer';

export { isForwardedEvent } from './flow/eventForward';
export type { PageGridDebugStats } from './grid/gridParts';

export interface PageGridRendererOptions {
  /** Max mounted sections (default 5), settle time before `relocate` (default 150 ms): as FlowRenderer. */
  maxMounted?: number;
  settleMs?: number;
  locatorBridge?: LocatorBridge;
  keyTarget?: EventTarget;
  onExternalLink?: (href: string) => void;
  /** layout.pageGap (px) until CompiledStyle carries `pageGapPx` (which then wins). Default 48. */
  pageGapPx?: number;
  /** Accepted for option parity with FlowRenderer and ignored: grid pages move whole rows. */
  pageOverlapLines?: number;
  /** layout.minSpreadWidthPx (default 1000): narrower viewports show one page per row. */
  minSpreadWidthPx?: number;
}

type Opts = Required<Pick<PageGridRendererOptions, 'maxMounted' | 'settleMs' | 'pageGapPx' | 'minSpreadWidthPx'>> &
  PageGridRendererOptions;

const EMPTY: Locator = { sectionIndex: 0, cfi: null, charOffset: 0, globalCharOffset: null, progress: 0, snippet: '' };

export class PageGridRenderer implements Renderer {
  #opts: Opts;
  #book: BookSource | null = null;
  #style: CompiledStyle | null = null;
  #slots: GridSlots | null = null;
  #events = new RendererEmitter('PageGridRenderer');
  #pins = new PinSet();
  #velocity = new ScrollVelocity();
  #position = new ScrollPosition();
  #motion = new ScrollAnimation(this);
  #raf = 0;
  #resizeRaf = 0;
  #settle = 0;
  #resizeEnd = 0;
  #nav = 0;
  #section = -1;
  #lastKey = '';
  #settlePending = false;
  /** The exact character a navigation/restore targeted; reported while its row is still shown. */
  #sticky: { index: number; range: Range } | null = null;
  #lastSize = { w: 0, h: 0 };
  #ro: ResizeObserver | null = null;
  #unlisten: () => void = () => {};
  #sizes: number[] = [];
  #shownPages: 1 | 2 = 2;

  constructor(o: PageGridRendererOptions = {}) {
    this.#opts = {
      ...o,
      maxMounted: o.maxMounted ?? 5,
      settleMs: o.settleMs ?? 150,
      pageGapPx: o.pageGapPx ?? 48,
      minSpreadWidthPx: o.minSpreadWidthPx ?? DEFAULT_MIN_SPREAD_WIDTH_PX,
    };
  }

  async mount(el: HTMLElement, book: BookSource, css: CompiledStyle, at?: Locator): Promise<void> {
    if (this.#slots) throw new Error('PageGridRenderer already mounted');
    this.#book = book;
    this.#style = css;
    this.#sizes = book.sections.map((s) => Math.max(0, s.size || 0));
    const target = (): EventTarget => this.#opts.keyTarget ?? el;
    const slots = new GridSlots(el, book, css, this.#gapOf(css), {
      frame: {
        onKey: (e) => forwardKey(e, target()),
        onWheel: (e) => forwardCtrlWheel(e, target()),
        onLink: (f, href) => this.#onLink(f, href),
      },
      onSectionReady: (f) => this.#onSectionReady(f),
      onLayoutChanged: () => this.#scheduleUpdate(),
    }, this.#opts.minSpreadWidthPx);
    this.#slots = slots;
    this.#shownPages = slots.geometry.cols;
    this.#events.emit('spread', { pagesPerView: this.#shownPages, requested: 2 });
    this.#unlisten = listenScroller(slots.scroller, this.#onScroll, this.cancelScrollAnimation);
    this.#lastSize = { w: slots.scroller.clientWidth, h: slots.scroller.clientHeight };
    this.#ro = new ResizeObserver(() => this.resize());
    this.#ro.observe(slots.scroller);
    if (!(at && (await this.#goToLocator(at, 'mount')))) {
      await this.#navigate(0, () => ({ y: 0, range: null }), 'mount');
    }
  }

  async setStyle(css: CompiledStyle): Promise<void> {
    this.cancelScrollAnimation();
    this.#style = css;
    const slots = this.#slots;
    if (!slots) return;
    const a = this.#anchor(slots, css);
    slots.applyStyle(css, this.#gapOf(css));
    this.#restore(a);
    this.#emitSpread();
    this.#emitRelocate('style');
  }

  async goTo(target: GoToTarget): Promise<void> {
    if (!('href' in target)) {
      await this.#goToLocator(target, 'goto');
      return;
    }
    const r = this.#book?.resolveHref(target.href);
    if (!r || r.index < 0 || r.index >= this.sectionCount) {
      console.warn(`[PageGridRenderer] unresolved href ${target.href}`);
      return;
    }
    await this.#navigate(r.index, this.#aligned(hrefPlacement(r)));
  }

  getLocatorRect(locator: Locator) {
    const slots = this.#slots;
    return locatorViewportRect(
      locator,
      (i) => slots?.frameAt(i) ?? null,
      slots?.scroller ?? null,
      this.#opts.locatorBridge,
      slots ? slots.geometry.textW + slots.geometry.colGap : 0,
    );
  }
  isAtEnd(): boolean {
    return this.getScrollTop() >= this.getMaxScroll();
  }

  getLocator(): Locator {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style) return { ...EMPTY };
    return locatorOf(slots, this.#anchor(slots, style), this.#sizes, this.#opts.locatorBridge);
  }

  scrollBy(px: number): void {
    const sc = this.#slots?.scroller;
    if (!sc || !Number.isFinite(px)) return;
    this.#position.by(sc, px);
  }

  /** PgDn/PgUp/Space: exactly one row (= one viewport), no overlap lines. Same easing as flow. */
  page(dir: 1 | -1): void {
    const slots = this.#slots;
    if (!slots) return;
    const base = this.#motion.active ? this.#motion.destination : slots.scroller.scrollTop;
    this.#motion.to(base + dir * gridPageStep(slots.geometry), prefersReducedMotion());
  }

  cancelScrollAnimation = (): void => {
    this.#motion.stop();
  };

  /** Coalesced to one relayout per frame; the sticky anchor keeps a resize burst drift-free. */
  resize(): void {
    if (this.#resizeRaf || !this.#slots) return;
    this.#resizeRaf = requestAnimationFrame(() => {
      this.#resizeRaf = 0;
      const slots = this.#slots;
      const style = this.#style;
      if (!slots || !style) return;
      const w = slots.scroller.clientWidth;
      const h = slots.scroller.clientHeight;
      if (w === this.#lastSize.w && h === this.#lastSize.h) return;
      this.cancelScrollAnimation();
      this.#lastSize = { w, h };
      const a = this.#anchor(slots, style);
      slots.applyStyle(style, this.#gapOf(style));
      this.#restore(a);
      this.#emitSpread();
      window.clearTimeout(this.#resizeEnd);
      this.#resizeEnd = window.setTimeout(() => this.#emitRelocate('resize'), 200);
    });
  }

  on<K extends RendererEventName>(ev: K, cb: (e: RendererEventMap[K]) => void): () => void {
    return this.#events.on(ev, cb);
  }

  destroy(): void {
    this.cancelScrollAnimation();
    this.#nav++;
    cancelAnimationFrame(this.#raf);
    cancelAnimationFrame(this.#resizeRaf);
    window.clearTimeout(this.#settle);
    window.clearTimeout(this.#resizeEnd);
    this.#ro?.disconnect();
    this.#unlisten();
    this.#slots?.destroy();
    this.#slots = null;
    this.#sticky = null;
    this.#events.clear();
    this.#book = null;
  }

  // ───────────── Same extras as FlowRenderer (smoothScroller, key router, overlay) ─────────────

  /** Pages per row actually shown: 2, or 1 below layout.minSpreadWidthPx (the setting stays 2). */
  getEffectivePagesPerView(): 1 | 2 {
    return this.#slots?.geometry.cols ?? this.#shownPages;
  }
  /** layout.minSpreadWidthPx changed: relayout now, locator preserved. */
  setMinSpreadWidth(px: number): void {
    if (!Number.isFinite(px) || px === this.#opts.minSpreadWidthPx) return;
    this.#opts.minSpreadWidthPx = px;
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style) return;
    slots.minSpreadWidthPx = px;
    if (slots.geometry.cols === (slots.scroller.clientWidth >= px ? 2 : 1)) return;
    this.cancelScrollAnimation();
    const a = this.#anchor(slots, style);
    slots.applyStyle(style, this.#gapOf(style));
    this.#restore(a);
    this.#emitSpread();
    this.#emitRelocate('resize');
  }

  get scrollElement(): HTMLElement | null {
    return this.#slots?.scroller ?? null;
  }
  getScrollTop(): number {
    return this.#slots?.scroller.scrollTop ?? 0;
  }
  setScrollTop(px: number): void {
    const sc = this.#slots?.scroller;
    if (!sc) return;
    this.cancelScrollAnimation();
    this.#position.reset();
    sc.scrollTop = clamp(px, 0, this.getMaxScroll());
  }
  getMaxScroll(): number {
    const sc = this.#slots?.scroller;
    return sc ? Math.max(0, sc.scrollHeight - sc.clientHeight) : 0;
  }
  getViewportHeight(): number {
    return this.#slots?.scroller.clientHeight ?? 0;
  }
  getLineHeight(): number {
    return this.#style?.lineHeightPx ?? 0;
  }
  /** Row pitch = page height = viewport height. */
  getRowHeight(): number {
    return this.#slots?.geometry.rowH ?? 0;
  }
  get sectionCount(): number {
    return this.#book?.sections.length ?? 0;
  }
  getSectionIndex(): number {
    return Math.max(0, this.#section);
  }
  /** No-op: two-page scroll pages by whole rows (owner decision). Kept for API parity. */
  setPageOverlapLines(n: number): void {
    void n;
  }
  /** Home/End: first/last row of the section; Ctrl+Home/End: first/last section (KB-04). */
  async goToSectionEdge(index: number, edge: 'start' | 'end'): Promise<void> {
    const n = this.sectionCount;
    if (n === 0) return;
    const i = clamp(Math.floor(index), 0, n - 1);
    const edgeY = (s: GridSlots): number =>
      sectionEdgeY(s.layout.contentTop(i), s.layout.contentHeight(i), s.geometry.rowH, edge);
    const slots = this.#slots;
    if (slots?.frameAt(i)) {
      const y = clamp(edgeY(slots), 0, this.getMaxScroll());
      if (Math.abs(y - this.getScrollTop()) <= 2 * this.getViewportHeight()) {
        this.#nav++;
        this.#sticky = null;
        this.#motion.to(y, prefersReducedMotion());
        return;
      }
    }
    await this.#navigate(i, () => ({ y: edgeY(this.#slots!), range: null }));
  }
  /** Dev perf overlay and the ADR-002 measurements. */
  debugStats(): PageGridDebugStats | null {
    const s = this.#slots;
    return s ? s.debugStats(stickyAnchor(s, this.#sticky) !== null) : null;
  }

  // ───────────── Internals ─────────────

  #gapOf = (css: CompiledStyle): number => pageGapOf(css, this.#opts.pageGapPx);

  #aligned(place: Placement): Placement {
    return rowAligned(place, () => this.#slots?.geometry.rowH ?? 1);
  }

  /** The sticky navigation target while its row is at the top (lossless restore), else first visible. */
  #anchor(slots: GridSlots, style: CompiledStyle): Anchor {
    return stickyAnchor(slots, this.#sticky) ?? captureGridAnchor(slots, style);
  }

  #onScroll = (): void => {
    this.#scheduleUpdate();
    window.clearTimeout(this.#settle);
    this.#settle = window.setTimeout(() => this.#onSettle(), this.#opts.settleMs);
  };

  #scheduleUpdate(): void {
    if (this.#raf) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.#update();
    });
  }

  /** Mount window + current-section tracking (identical policy to FlowRenderer). */
  #update(): void {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style || slots.layout.count === 0) return;
    const st = slots.scroller.scrollTop;
    const v = this.#velocity.sample(st, performance.now());
    const win = mountWindow(slots.layout, st, slots.scroller.clientHeight, v, this.#opts.maxMounted);
    slots.reconcile(win, this.#pins.pinned, this.#opts.maxMounted);
    const cur = slots.layout.indexAt(st + 0.5 * style.lineHeightPx);
    if (cur !== this.#section) {
      this.#section = cur;
      this.#events.emit('section', { index: cur });
    }
  }

  #onSettle(): void {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style) return;
    const a = this.#anchor(slots, style);
    this.#settlePending = !a.range;
    if (a.range) slots.textAnchor = textAnchorOf(a);
    this.#emitRelocate('scroll', a);
  }

  #onSectionReady(f: SectionFrame): void {
    if (f.doc) this.#events.emit('load', { index: f.index, doc: f.doc });
    if (this.#settlePending) this.#onSettle();
  }

  /** Row-aligned restore; the anchor character becomes sticky so repeated restores never drift. */
  #restore(a: Anchor): void {
    const slots = this.#slots;
    if (!slots) return;
    const t = gridRestoreTarget(slots, a);
    this.#position.reset();
    slots.scroller.scrollTop = clamp(t.scrollTop, 0, this.getMaxScroll());
    const range = t.exact ? liveRange(slots, a) : null;
    this.#sticky = range ? { index: a.index, range } : null;
    if (range) slots.textAnchor = textAnchorOf(a);
  }

  #emitSpread(): void {
    const cols = this.#slots?.geometry.cols;
    if (!cols || cols === this.#shownPages) return;
    this.#shownPages = cols;
    this.#events.emit('spread', { pagesPerView: cols, requested: 2 });
  }

  #emitRelocate(reason: RelocateReason, anchor?: Anchor): void {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style) return;
    const a = anchor ?? this.#anchor(slots, style);
    const locator = locatorOf(slots, a, this.#sizes, this.#opts.locatorBridge);
    const key = `${locator.sectionIndex}:${locator.charOffset}:${a.range ? 1 : 0}`;
    if (reason === 'scroll' && key === this.#lastKey) return;
    this.#lastKey = key;
    this.#events.emit('relocate', { locator, reason });
  }

  async #goToLocator(loc: Locator, reason: RelocateReason): Promise<boolean> {
    for (const attempt of locatorAttempts(loc, this.#sizes, this.#opts.locatorBridge)) {
      const a = attempt();
      if (!a || !(a[0] >= 0 && a[0] < this.sectionCount)) continue;
      const r = await this.#navigate(a[0], this.#aligned(a[1]), reason);
      if (r !== false) return true; // done, or superseded by a newer navigation
    }
    return false;
  }

  /**
   * Mount `index`, then jump to the placement's row (only the target mounts first, so the old view
   * stays until the jump). The placed character becomes sticky. 'stale' = superseded.
   */
  async #navigate(index: number, place: Placement, reason: RelocateReason = 'goto'): Promise<boolean | 'stale'> {
    const slots = this.#slots;
    if (!slots) return false;
    this.cancelScrollAnimation();
    const token = ++this.#nav;
    this.#pins.pin(index, 1);
    try {
      const f = await slots.ensureMounted(index);
      if (token !== this.#nav || this.#slots !== slots) return 'stale';
      if (!f || !this.#style) return false;
      const p = place(f, slots.layout.contentTop(index));
      if (!p) return false;
      this.#position.reset();
      slots.scroller.scrollTop = clamp(p.y, 0, this.getMaxScroll());
      this.#sticky = p.range ? { index, range: p.range } : null;
      const a = this.#anchor(slots, this.#style);
      slots.textAnchor = textAnchorOf(a);
      this.#update();
      this.#emitRelocate(reason, a);
      return true;
    } finally {
      this.#pins.pin(index, -1);
    }
  }

  #onLink(f: SectionFrame, raw: string): void {
    const link = resolveLink(this.#book, f.index, raw);
    if (!link) return;
    if ('external' in link) this.#opts.onExternalLink?.(link.external);
    else void this.goTo({ href: link.href });
  }
}
