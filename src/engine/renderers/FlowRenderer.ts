import { locatorViewportRect } from './locatorRect';
/**
 * FlowRenderer (PRD FR-LM-1, §10.4 step 4; ADR-001): scroll flow, one page.
 * All sections stacked in one vertical scroll container as auto-height sandboxed iframes, with at most
 * 5 mounted at a time; the rest are spacers of measured or estimated height. One centred text column
 * at any width. Framework-agnostic: ReaderView mounts it into any element with a definite height.
 */
import type { Locator } from '@contract/types';
import type { BookSource } from '../book/BookSource';
import type { CompiledStyle } from '../style/types';
import { ScrollAnimation } from '../input/scrollAnimation';
import { ScrollPosition } from './flow/scrollPosition';
import { forwardCtrlWheel, forwardKey } from './flow/eventForward';
import {
  captureAnchor,
  hrefPlacement,
  locatorAttempts,
  locatorOf,
  restoreTarget,
  textAnchorOf,
  type Anchor,
  type LocatorBridge,
  type Placement,
} from './flow/flowAnchor';
import { clamp, pageStep, ScrollVelocity } from './flow/flowMath';
import { FlowSlots, type AnchorStats } from './flow/flowSlots';
import type { SectionFrame } from './flow/sectionFrame';
import { selectWindow } from './flow/slotWindow';
import type {
  GoToTarget,
  RelocateReason,
  Renderer,
  RendererEventMap,
  RendererEventName,
} from './Renderer';

export type { LocatorBridge } from './flow/flowAnchor';
export { isForwardedEvent } from './flow/eventForward';

export interface FlowRendererOptions {
  /** scroll.pageOverlapLines (LM-06). Default 2. */
  pageOverlapLines?: number;
  /** Max mounted sections (LM-01). Default 5. */
  maxMounted?: number;
  /** CFI / TXT global offsets (locator.ts, M1.5b). Without it, cfi and globalCharOffset are null. */
  locatorBridge?: LocatorBridge;
  /** Where key/Ctrl+wheel events from section iframes are re-dispatched (bubbling). Default: mount element. */
  keyTarget?: EventTarget;
  /** External link clicked inside the book (internal links navigate by themselves). */
  onExternalLink?: (href: string) => void;
  /** Quiet time after the last scroll before `relocate` fires. Default 150 ms. */
  settleMs?: number;
  /** Native CSS scroll anchoring in addition to manual correction. Default false (scroll audit). */
  nativeAnchoring?: boolean;
}

type Opts = Required<Omit<FlowRendererOptions, 'locatorBridge' | 'keyTarget' | 'onExternalLink'>> &
  FlowRendererOptions;
type Listeners = { [K in RendererEventName]: Set<(e: RendererEventMap[K]) => void> };

/** Above this speed (viewports per second) the mount radius grows from 1 to 2. */
const FAST_VIEWPORTS_PER_SEC = 3;
const EXTERNAL = /^(?!blob:)[a-z][a-z0-9+.-]*:/i;

export class FlowRenderer implements Renderer {
  #opts: Opts;
  #book: BookSource | null = null;
  #style: CompiledStyle | null = null;
  #slots: FlowSlots | null = null;
  #ls: Listeners = { relocate: new Set(), section: new Set(), load: new Set(), spread: new Set() };
  #pinned = new Set<number>();
  #pinCount = new Map<number, number>();
  #velocity = new ScrollVelocity();
  #raf = 0;
  #resizeRaf = 0;
  #settle = 0;
  #resizeEnd = 0;
  #nav = 0;
  #position = new ScrollPosition();
  #motion = new ScrollAnimation(this);
  #section = -1;
  #lastKey = '';
  #settlePending = false;
  #resizeAnchor: Anchor | null = null;
  #lastSize = { w: 0, h: 0 };
  #ro: ResizeObserver | null = null;
  #sizes: number[] = [];

  constructor(options: FlowRendererOptions = {}) {
    this.#opts = {
      pageOverlapLines: 2,
      maxMounted: 5,
      settleMs: 150,
      nativeAnchoring: false,
      ...options,
    };
  }

  // ───────────── Renderer ─────────────

  async mount(el: HTMLElement, book: BookSource, css: CompiledStyle, at?: Locator): Promise<void> {
    if (this.#slots) throw new Error('FlowRenderer already mounted');
    this.#book = book;
    this.#style = css;
    this.#sizes = book.sections.map((s) => Math.max(0, s.size || 0));
    const target = (): EventTarget => this.#opts.keyTarget ?? el;
    const slots = new FlowSlots(el, book, css, {
      frame: {
        onKey: (e) => forwardKey(e, target()),
        onWheel: (e) => forwardCtrlWheel(e, target()),
        onLink: (f, href) => this.#onLink(f, href),
      },
      onSectionReady: (f) => this.#onSectionReady(f),
      onLayoutChanged: () => this.#scheduleUpdate(),
      nativeAnchoring: this.#opts.nativeAnchoring,
    });
    this.#slots = slots;
    slots.scroller.addEventListener('scroll', this.#onScroll, { passive: true });
    slots.scroller.addEventListener('wheel', this.cancelScrollAnimation, { passive: true });
    slots.scroller.addEventListener('pointerdown', this.cancelScrollAnimation, { passive: true });
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
    const a = this.#resizeAnchor ?? captureAnchor(slots, css);
    slots.applyStyle(css);
    this.#restore(a);
    this.#emitRelocate('style');
  }

  async goTo(target: GoToTarget): Promise<void> {
    if (!('href' in target)) {
      await this.#goToLocator(target, 'goto');
      return;
    }
    const r = this.#book?.resolveHref(target.href);
    if (!r || r.index < 0 || r.index >= this.sectionCount) {
      console.warn(`[FlowRenderer] unresolved href ${target.href}`);
      return;
    }
    await this.#navigate(r.index, hrefPlacement(r));
  }

  getLocatorRect(locator: Locator) {
    const slots = this.#slots;
    return locatorViewportRect(
      locator,
      (i) => slots?.frameAt(i) ?? null,
      slots?.scroller ?? null,
      this.#opts.locatorBridge,
    );
  }
  isAtEnd(): boolean {
    return this.getScrollTop() >= this.getMaxScroll();
  }

  getLocator(): Locator {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style) {
      return {
        sectionIndex: 0,
        cfi: null,
        charOffset: 0,
        globalCharOffset: null,
        progress: 0,
        snippet: '',
      };
    }
    return locatorOf(slots, captureAnchor(slots, style), this.#sizes, this.#opts.locatorBridge);
  }

  /** Immediate scroll; sub-pixel remainders are accumulated so slow auto-scroll still moves. */
  scrollBy(px: number): void {
    const sc = this.#slots?.scroller;
    if (!sc || !Number.isFinite(px)) return;
    this.#position.by(sc, px);
  }

  /** PgDn/PgUp/Space (LM-06): 200ms ease-out, viewport minus overlap lines. */
  page(dir: 1 | -1): void {
    const sc = this.#slots?.scroller;
    if (!sc || !this.#style) return;
    this.#nav++;
    const base = this.#motion.active ? this.#motion.destination : sc.scrollTop;
    this.#motion.to(
      base + dir * pageStep(sc.clientHeight, this.#style.lineHeightPx, this.#opts.pageOverlapLines),
      this.#reducedMotion(),
    );
  }

  cancelScrollAnimation = (): void => {
    this.#motion.stop();
  };

  #reducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Coalesced to one relayout per frame; the anchor captured at the start of a resize burst is reused. */
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
      const a = (this.#resizeAnchor ??= captureAnchor(slots, style));
      slots.applyStyle(style);
      this.#restore(a);
      window.clearTimeout(this.#resizeEnd);
      this.#resizeEnd = window.setTimeout(() => {
        this.#resizeAnchor = null;
        this.#emitRelocate('resize');
      }, 200);
    });
  }

  on<K extends RendererEventName>(ev: K, cb: (e: RendererEventMap[K]) => void): () => void {
    const set = this.#ls[ev] as Set<(e: RendererEventMap[K]) => void>;
    set.add(cb);
    return () => set.delete(cb);
  }

  destroy(): void {
    this.cancelScrollAnimation();
    this.#nav++;
    cancelAnimationFrame(this.#raf);
    cancelAnimationFrame(this.#resizeRaf);
    window.clearTimeout(this.#settle);
    window.clearTimeout(this.#resizeEnd);
    this.#ro?.disconnect();
    this.#slots?.scroller.removeEventListener('scroll', this.#onScroll);
    this.#slots?.scroller.removeEventListener('wheel', this.cancelScrollAnimation);
    this.#slots?.scroller.removeEventListener('pointerdown', this.cancelScrollAnimation);
    this.#slots?.destroy();
    this.#slots = null;
    for (const set of Object.values(this.#ls)) set.clear();
    this.#book = null;
  }

  // ───────────── Extras for smoothScroller / autoScroller / key router (M1.4) ─────────────

  /** The element that scrolls (wheel/touchpad scroll it natively). */
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
  /** Current line height in px (tap scroll = scroll.tapLines × this). */
  getLineHeight(): number {
    return this.#style?.lineHeightPx ?? 0;
  }
  get sectionCount(): number {
    return this.#book?.sections.length ?? 0;
  }
  /** Section under the reading line. */
  /** Scroll + one page always shows one page (never a spread, FR-LM-0). */
  getEffectivePagesPerView(): 1 | 2 {
    return 1;
  }
  /** No-op: one page has no spread to fall back from. Kept for API parity. */
  setMinSpreadWidth(px: number): void {
    void px;
  }
  getSectionIndex(): number {
    return Math.max(0, this.#section);
  }
  setPageOverlapLines(n: number): void {
    this.#opts.pageOverlapLines = Math.max(0, Math.floor(n));
  }
  /** Home/End: current section; Ctrl+Home/End: first/last (KB-04). */
  async goToSectionEdge(index: number, edge: 'start' | 'end'): Promise<void> {
    const n = this.sectionCount;
    if (n === 0) return;
    const i = clamp(Math.floor(index), 0, n - 1);
    const slots = this.#slots;
    if (slots?.frameAt(i)) {
      const top = slots.layout.contentTop(i);
      const y = clamp(
        edge === 'start'
          ? i === 0
            ? 0
            : top
          : top + slots.layout.contentHeight(i) - slots.scroller.clientHeight,
        0,
        this.getMaxScroll(),
      );
      if (Math.abs(y - this.getScrollTop()) <= 2 * this.getViewportHeight()) {
        this.#nav++;
        this.#motion.to(y, this.#reducedMotion());
        return;
      }
    }
    await this.#navigate(i, (f, top) => {
      if (edge === 'start') return { y: i === 0 ? 0 : top, range: null };
      const slots = this.#slots!;
      return {
        y: top + slots.layout.contentHeight(f.index) - slots.scroller.clientHeight,
        range: null,
      };
    });
  }
  /** Dev perf overlay and spike measurements (ADR-001). */
  debugStats(): { mounted: number[]; pxPerUnit: number; anchoring: AnchorStats } | null {
    const s = this.#slots;
    return s
      ? { mounted: s.mountedIndices(), pxPerUnit: s.pxPerUnit, anchoring: { ...s.stats } }
      : null;
  }

  // ───────────── Internals ─────────────

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

  /** Mount window + current-section tracking. Runs at most once per frame. */
  #update(): void {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style || slots.layout.count === 0) return;
    const st = slots.scroller.scrollTop;
    const vh = slots.scroller.clientHeight;
    const v = this.#velocity.sample(st, performance.now());
    const win = selectWindow({
      firstVisible: slots.layout.indexAt(st),
      lastVisible: slots.layout.indexAt(st + Math.max(0, vh - 1)),
      count: slots.layout.count,
      radius: Math.abs(v) > FAST_VIEWPORTS_PER_SEC * vh ? 2 : 1,
      maxMounted: this.#opts.maxMounted,
      direction: v > 1 ? 1 : v < -1 ? -1 : 0,
    });
    slots.reconcile(win, this.#pinned, this.#opts.maxMounted);
    const cur = slots.layout.indexAt(st + 0.5 * style.lineHeightPx);
    if (cur !== this.#section) {
      this.#section = cur;
      this.#emit('section', { index: cur });
    }
  }

  #onSettle(): void {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style) return;
    const a = captureAnchor(slots, style);
    // Section not loaded yet: emit the approximate locator now, the exact one once it is ready.
    this.#settlePending = !a.range;
    if (a.range) slots.textAnchor = textAnchorOf(a);
    this.#emitRelocate('scroll', a);
  }

  #onSectionReady(f: SectionFrame): void {
    if (f.doc) this.#emit('load', { index: f.index, doc: f.doc });
    if (this.#settlePending) this.#onSettle();
  }

  #restore(a: Anchor): void {
    const slots = this.#slots;
    if (!slots) return;
    const t = restoreTarget(slots, a);
    this.#position.reset();
    slots.scroller.scrollTop = t.scrollTop;
    if (t.exact) slots.textAnchor = textAnchorOf(a);
  }

  #emitRelocate(reason: RelocateReason, anchor?: Anchor): void {
    const slots = this.#slots;
    const style = this.#style;
    if (!slots || !style) return;
    const a = anchor ?? captureAnchor(slots, style);
    const locator = locatorOf(slots, a, this.#sizes, this.#opts.locatorBridge);
    const key = `${locator.sectionIndex}:${locator.charOffset}:${a.range ? 1 : 0}`;
    if (reason === 'scroll' && key === this.#lastKey) return;
    this.#lastKey = key;
    this.#emit('relocate', { locator, reason });
  }

  async #goToLocator(loc: Locator, reason: RelocateReason): Promise<boolean> {
    for (const attempt of locatorAttempts(loc, this.#sizes, this.#opts.locatorBridge)) {
      const a = attempt();
      if (!a || !(a[0] >= 0 && a[0] < this.sectionCount)) continue;
      const r = await this.#navigate(a[0], a[1], reason);
      if (r !== false) return true; // done, or superseded by a newer navigation: stop either way
    }
    return false;
  }

  /**
   * Mount `index`, then jump so the placement's line is at the viewport top. Only the target is
   * mounted first, so the old view stays on screen until the jump (no blank flash); neighbours mount
   * afterwards via #update and their measured heights are absorbed by anchoring.
   * Returns false if the placement failed, 'stale' if a newer navigation superseded this one.
   */
  async #navigate(
    index: number,
    place: Placement,
    reason: RelocateReason = 'goto',
  ): Promise<boolean | 'stale'> {
    const slots = this.#slots;
    if (!slots) return false;
    this.cancelScrollAnimation();
    const token = ++this.#nav;
    this.#pin(index, 1);
    try {
      const f = await slots.ensureMounted(index, this.#opts.maxMounted);
      if (token !== this.#nav || this.#slots !== slots) return 'stale';
      if (!f || !this.#style) return false;
      const p = place(f, slots.layout.contentTop(index));
      if (!p) return false;
      this.#position.reset();
      slots.scroller.scrollTop = clamp(p.y, 0, this.getMaxScroll());
      const a = captureAnchor(slots, this.#style);
      slots.textAnchor = textAnchorOf(p.range ? { ...a, index, range: p.range } : a);
      this.#update();
      this.#emitRelocate(reason, a);
      return true;
    } finally {
      this.#pin(index, -1);
    }
  }

  /** Pins are counted so overlapping navigations to the same section do not unpin each other. */
  #pin(index: number, delta: 1 | -1): void {
    const c = (this.#pinCount.get(index) ?? 0) + delta;
    if (c > 0) {
      this.#pinCount.set(index, c);
      this.#pinned.add(index);
    } else {
      this.#pinCount.delete(index);
      this.#pinned.delete(index);
    }
  }

  #onLink(f: SectionFrame, raw: string): void {
    if (!raw) return;
    if (EXTERNAL.test(raw)) {
      this.#opts.onExternalLink?.(raw);
      return;
    }
    const section = this.#book?.sections[f.index];
    const href = raw.startsWith('#')
      ? `${section?.id ?? ''}${raw}`
      : (section?.resolveHref?.(raw) ?? raw);
    void this.goTo({ href });
  }

  #emit<K extends RendererEventName>(ev: K, payload: RendererEventMap[K]): void {
    for (const cb of this.#ls[ev] as Set<(e: RendererEventMap[K]) => void>) {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[FlowRenderer] ${ev} listener failed`, e);
      }
    }
  }
}
