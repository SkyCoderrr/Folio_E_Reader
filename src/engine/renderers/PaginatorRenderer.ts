import { locatorViewportRect } from './locatorRect';
/**
 * PaginatorRenderer (PRD FR-LM-3, §10.4 step 6; ADR-004, ADR-005): every page-based layout.
 *   paged + 1 page          → one page per view; a turn slides the strip by one page (~180 ms).
 *   any flow + 2 pages      → the two-page FILMSTRIP (owner decision t20u, ADR-005): two pages side
 *                             by side; every advance moves ONE page (left page slides out, right
 *                             page moves into the left slot, the next page enters on the right).
 *                             Held arrow keys and continuous wheel move the strip continuously and
 *                             settle on a page boundary. Below layout.minSpreadWidthPx it shows one
 *                             page and keeps the same behaviour.
 * The mounted sections form one horizontal strip of columns (paged/stripMath.ts), so a chapter's
 * last page and the next chapter's first page can sit side by side and a step never waits.
 * Motion is transform-only (paged/stripMotion.ts); prefers-reduced-motion = instant steps.
 * Own column pagination instead of foliate-js's paginator: foliate's iframes need `allow-scripts`
 * (PRD §10.4 step 2 forbids it) and its turns wait on animation/timers (ADR-004).
 *
 * A page target (smoothScroller's PagedTarget, kind 'paged'): page(±1) steps one page; a key press
 * is holdStart/holdMove/holdEnd (one page per press in paged + 1; continuous motion while held in
 * the filmstrip, also across section boundaries); goToSectionEdge = first/last page(s) of a
 * section. Wheel and click zones (left/right thirds; paged flow only) are handled here.
 */
import type { Locator } from '@contract/types';
import type { BookSource } from '../book/BookSource';
import type { FrameClock } from '../input/scrollAnimation';
import type { CompiledStyle } from '../style/types';
import { forwardCtrlWheel, forwardKey } from './flow/eventForward';
import { isBookEnd, locatorAttempts, locatorOf, type Anchor, type LocatorBridge } from './flow/flowAnchor';
import { clamp } from './flow/flowMath';
import type { SectionFrame } from './flow/sectionFrame';
import { columnOfTarget, firstVisibleInColumn } from './paged/pagedAnchor';
import { PagedFrames } from './paged/pagedFrames';
import { clickZone, DEFAULT_MIN_SPREAD_WIDTH_PX, effectivePages, WheelPager, type PagedGeometry } from './paged/pagedMath';
import { locateColumn, stripBounds, visibleSections, type StripBlock, type StripBounds } from './paged/stripMath';
import { StripMotion } from './paged/stripMotion';
import { PinSet, prefersReducedMotion, RendererEmitter, resolveLink } from './rendererParts';
import type { GoToTarget, RelocateReason, Renderer, RendererEventMap, RendererEventName } from './Renderer';

export { isForwardedEvent } from './flow/eventForward';

export interface PaginatorRendererOptions {
  /** reader.pagesPerView (default 1). 2 = the filmstrip (opt-in); one page below minSpreadWidthPx. */
  pagesPerView?: 1 | 2;
  /** layout.minSpreadWidthPx (default 1000). */
  minSpreadWidthPx?: number;
  locatorBridge?: LocatorBridge;
  keyTarget?: EventTarget;
  onExternalLink?: (href: string) => void;
  /** Accepted for option parity with FlowRenderer and ignored: pages move whole. */
  pageOverlapLines?: number;
  /** Left/right-third clicks turn pages (LM-03). Default true; createRenderer: paged flow only. */
  clickZones?: boolean;
  /** Tests: frame clock for the strip motion, and the reduced-motion source. */
  clock?: FrameClock;
  reducedMotion?: () => boolean;
}

export interface PaginatorDebugStats {
  mounted: number[];
  geometry: PagedGeometry;
  /** Section and in-section column of the left page the view rests on (or is moving to). */
  index: number;
  column: number;
  columns: number;
  sticky: boolean;
  moving: boolean;
}

/** Placement inside a mounted section: the left page's column and the exact target character. */
type ColumnPick = (f: SectionFrame) => { column: number; range: Range | null } | null;

const EMPTY: Locator = { sectionIndex: 0, cfi: null, charOffset: 0, globalCharOffset: null, progress: 0, snippet: '' };
/** Filmstrip wheel: travel that starts a step, and the quiet time that ends a wheel gesture. */
const WHEEL_START_PX = 40;
const WHEEL_QUIET_MS = 160;
/**
 * Filmstrip wheel: an event after this pause, with at least this travel, is discrete (a mouse-wheel
 * notch: one page each, at any notch size). Touchpads stream an event every frame (8-16 ms).
 */
const WHEEL_DISCRETE_GAP_MS = 40;
const WHEEL_DISCRETE_MIN_PX = 20;

interface Hold {
  dir: 1 | -1;
  source: 'key' | 'wheel';
}

export class PaginatorRenderer implements Renderer {
  /** Page target: held keys and auto-scroll turn pages (input/smoothScroller.ts, autoScroller.ts). */
  readonly kind = 'paged' as const;
  #requested: 1 | 2;
  #minSpread: number;
  #opts: PaginatorRendererOptions;
  #book: BookSource | null = null;
  #style: CompiledStyle | null = null;
  #frames: PagedFrames | null = null;
  #events = new RendererEmitter('PaginatorRenderer');
  #pins = new PinSet();
  #wheel = new WheelPager();
  #motion: StripMotion;
  #sizes: number[] = [];
  /** Strip base: the section whose first column is x = 0 (the left page's section at rest). */
  #base = -1;
  #nav = 0;
  #navigating = 0;
  #section = -1;
  #lastKey = '';
  #hold: Hold | null = null;
  #wheelSum = 0;
  #wheelEnd = 0;
  #lastWheel = -Infinity;
  /** The exact character a navigation/restore targeted; reported while it is in view. */
  #sticky: { index: number; range: Range } | null = null;
  /** Range of the last reported position: keeps it in view when its section reflows. */
  #viewAnchor: { index: number; range: Range } | null = null;
  #shownPages: 1 | 2 = 1;
  #lastSize = { w: 0, h: 0 };
  #resizeRaf = 0;
  #resizeEnd = 0;
  #ro: ResizeObserver | null = null;
  #off: Array<() => void> = [];

  constructor(o: PaginatorRendererOptions = {}) {
    this.#opts = o;
    this.#requested = o.pagesPerView === 2 ? 2 : 1;
    this.#minSpread = o.minSpreadWidthPx ?? DEFAULT_MIN_SPREAD_WIDTH_PX;
    this.#motion = new StripMotion(
      (x) => this.#apply(x),
      () => this.#settled(),
      o.clock,
    );
  }

  /** Two pages requested: the filmstrip (continuous held motion), also in the one-page fallback. */
  get #filmstrip(): boolean {
    return this.#requested === 2;
  }

  async mount(el: HTMLElement, book: BookSource, css: CompiledStyle, at?: Locator): Promise<void> {
    if (this.#frames) throw new Error('PaginatorRenderer already mounted');
    this.#book = book;
    this.#style = css;
    this.#sizes = book.sections.map((s) => Math.max(0, s.size || 0));
    const target = (): EventTarget => this.#opts.keyTarget ?? el;
    const colsFor = (w: number): 1 | 2 => effectivePages(this.#requested, w, this.#minSpread);
    const frames = new PagedFrames(el, book, css, css.pageGapPx, colsFor, {
      frame: {
        onKey: (e) => forwardKey(e, target()),
        onWheel: (e) => (e.ctrlKey ? forwardCtrlWheel(e, target()) : this.#onWheel(e)),
        onLink: (f, href) => this.#onLink(f, href),
      },
      onSectionReady: (f) => {
        if (f.doc) this.#events.emit('load', { index: f.index, doc: f.doc });
      },
      onReflow: (f) => this.#onReflow(f),
      onClick: (x) => this.#onClick(x),
    });
    this.#frames = frames;
    this.#shownPages = frames.geometry.cols;
    this.#events.emit('spread', { pagesPerView: this.#shownPages, requested: this.#requested });
    const root = frames.root;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) this.#onWheel(e);
    };
    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      this.#onClick(e.clientX);
    };
    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('click', onClick);
    this.#off.push(
      () => root.removeEventListener('wheel', onWheel),
      () => root.removeEventListener('click', onClick),
    );
    this.#lastSize = { w: root.clientWidth, h: root.clientHeight };
    this.#ro = new ResizeObserver(() => this.resize());
    this.#ro.observe(root);
    if (!(at && (await this.#goToLocator(at, 'mount')))) {
      await this.#navigate(0, () => ({ column: 0, range: null }), 'mount');
    }
  }

  async setStyle(css: CompiledStyle): Promise<void> {
    this.#style = css;
    this.#relayout('style');
  }

  async goTo(target: GoToTarget): Promise<void> {
    if (!('href' in target)) {
      await this.#goToLocator(target, 'goto');
      return;
    }
    const r = this.#book?.resolveHref(target.href);
    if (!r || r.index < 0 || r.index >= this.sectionCount) {
      console.warn(`[PaginatorRenderer] unresolved href ${target.href}`);
      return;
    }
    await this.#navigate(r.index, (f) => {
      const t = f.doc && r.anchor ? r.anchor(f.doc) : null;
      if (!t || !f.doc) return { column: 0, range: null };
      const range = 'nodeType' in t ? f.doc.createRange() : t;
      if ('nodeType' in t) {
        range.selectNodeContents(t);
        range.collapse(true);
      }
      return { column: columnOfTarget(t, this.#g()) ?? 0, range };
    });
  }

  getLocatorRect(locator: Locator) {
    const frames = this.#frames;
    return locatorViewportRect(
      locator,
      (i) => frames?.frameAt(i) ?? null,
      frames?.clip ?? null,
      this.#opts.locatorBridge,
      frames?.geometry.pitch,
    );
  }

  isAtEnd(): boolean {
    const b = this.#bounds();
    return !!b && b.atBookEnd && this.#restColumn(b) >= b.max;
  }

  getLocator(): Locator {
    const frames = this.#frames;
    if (!frames || !this.#style || this.#base < 0) return { ...EMPTY };
    return locatorOf(frames, this.#anchor(), this.#sizes, this.#opts.locatorBridge, this.isAtEnd());
  }

  /**
   * Key press: one page now. True when the view then follows the held key (filmstrip with motion);
   * paged + 1 and reduced motion turn one page per press.
   */
  holdStart(direction: 1 | -1): boolean {
    if (!this.#frames) return false;
    if (!this.#filmstrip || this.#reduced()) {
      this.page(direction);
      return false;
    }
    this.#endWheel();
    this.#endHold();
    this.#hold = { dir: direction, source: 'key' };
    this.#step(direction);
    return true;
  }

  /** Continuous travel of a held key (filmstrip). False once the book edge is reached. */
  holdMove(px: number): boolean {
    const h = this.#hold;
    if (h?.source !== 'key') return false;
    if (Number.isFinite(px) && Math.sign(px) === h.dir) this.#drive(px);
    const b = this.#bounds();
    if (!b) return true;
    const rest = this.#restColumn(b);
    return h.dir > 0 ? !(b.atBookEnd && rest >= b.max) : !(b.atBookStart && rest <= b.min);
  }

  /** The held key was released (or motion stopped: edge, focus loss): settle on a page. */
  holdEnd(): void {
    if (this.#hold?.source === 'key') this.#endHold();
  }

  /** Next/previous page (PgDn/PgUp/Space/arrows left-right, clicks, auto-scroll). Animated. */
  page(dir: 1 | -1): void {
    if (this.#hold) this.#endHold();
    this.#step(dir);
  }

  /** Coalesced to one relayout per frame; the sticky anchor keeps a resize burst drift-free. */
  resize(): void {
    if (this.#resizeRaf || !this.#frames) return;
    this.#resizeRaf = requestAnimationFrame(() => {
      this.#resizeRaf = 0;
      const root = this.#frames?.root;
      if (!root) return;
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (w === this.#lastSize.w && h === this.#lastSize.h) return;
      this.#lastSize = { w, h };
      this.#relayout(null);
      window.clearTimeout(this.#resizeEnd);
      this.#resizeEnd = window.setTimeout(() => this.#emitRelocate('resize'), 200);
    });
  }

  on<K extends RendererEventName>(ev: K, cb: (e: RendererEventMap[K]) => void): () => void {
    return this.#events.on(ev, cb);
  }

  destroy(): void {
    this.#nav++;
    this.#motion.stop();
    this.#hold = null;
    cancelAnimationFrame(this.#resizeRaf);
    window.clearTimeout(this.#resizeEnd);
    window.clearTimeout(this.#wheelEnd);
    this.#ro?.disconnect();
    for (const off of this.#off) off();
    this.#off = [];
    this.#frames?.destroy();
    this.#frames = null;
    this.#base = -1;
    this.#sticky = null;
    this.#viewAnchor = null;
    this.#events.clear();
    this.#book = null;
  }

  // ───────────── PagedRenderer extras (reader session, key router) ─────────────

  get scrollElement(): HTMLElement | null {
    return this.#frames?.root ?? null;
  }
  getViewportHeight(): number {
    return this.#frames?.root.clientHeight ?? 0;
  }
  getLineHeight(): number {
    return this.#style?.lineHeightPx ?? 0;
  }
  get sectionCount(): number {
    return this.#book?.sections.length ?? 0;
  }
  getSectionIndex(): number {
    return Math.max(0, this.#section);
  }
  /** Home/End: first/last page(s) of the section; Ctrl+Home/End: of the first/last section. */
  goToSectionEdge(index: number, edge: 'start' | 'end'): Promise<void> {
    return this.#goToEdge(index, edge, 'goto');
  }
  async #goToEdge(index: number, edge: 'start' | 'end', reason: RelocateReason): Promise<void> {
    const n = this.sectionCount;
    if (n === 0) return;
    const i = clamp(Math.floor(index), 0, n - 1);
    await this.#navigate(
      i,
      (f) => ({
        column: edge === 'start' ? 0 : Math.max(0, (this.#frames?.columns(f.index) ?? 1) - this.#cols()),
        range: null,
      }),
      reason,
    );
  }
  /** Pages per view actually shown: the request, or 1 below layout.minSpreadWidthPx. */
  getEffectivePagesPerView(): 1 | 2 {
    return this.#frames?.geometry.cols ?? this.#shownPages;
  }
  /** layout.minSpreadWidthPx changed: relayout now if the effective page count changes. */
  setMinSpreadWidth(px: number): void {
    if (!Number.isFinite(px) || px === this.#minSpread) return;
    this.#minSpread = px;
    const frames = this.#frames;
    if (frames && effectivePages(this.#requested, frames.root.clientWidth, px) !== frames.geometry.cols) {
      this.#relayout('resize');
    }
  }
  debugStats(): PaginatorDebugStats | null {
    const f = this.#frames;
    const b = this.#bounds();
    if (!f || !b) return null;
    const rest = locateColumn(b.block, this.#restColumn(b));
    return {
      mounted: f.mountedIndices(),
      geometry: { ...f.geometry },
      index: rest.index,
      column: rest.column,
      columns: f.columns(rest.index),
      sticky: this.#stickyShown(rest.index, rest.column) !== null,
      moving: this.#motion.active,
    };
  }

  // ───────────── Internals ─────────────

  #g = (): PagedGeometry => this.#frames!.geometry;
  #cols = (): 1 | 2 => this.#frames?.geometry.cols ?? 1;
  #pitch = (): number => Math.max(1, this.#frames?.geometry.pitch ?? 1);
  #reduced = (): boolean => (this.#opts.reducedMotion ?? prefersReducedMotion)();

  #bounds(): (StripBounds & { block: StripBlock }) | null {
    const frames = this.#frames;
    if (!frames || this.#base < 0 || !frames.frameAt(this.#base)) return null;
    const block = frames.block(this.#base);
    return { ...stripBounds(block, this.sectionCount, frames.geometry.cols), block };
  }

  /** Base-relative column of the left page the view rests on, or is moving to. */
  #restColumn(b: StripBounds): number {
    return clamp(Math.round(this.#motion.target / this.#pitch()), b.min, b.max);
  }

  /** One page in `dir` from the current target; across a section not loaded yet: navigate. */
  #step(dir: 1 | -1): void {
    const frames = this.#frames;
    if (!frames || this.#navigating > 0) return;
    let b = this.#bounds();
    if (!b) return;
    const from = this.#restColumn(b);
    if (dir > 0 && from + 1 > b.max && frames.remeasure(b.block.last)) b = this.#bounds()!; // late reflow
    const to = from + dir;
    this.#sticky = null;
    if (to > b.max) {
      if (!b.atBookEnd) void this.#navigate(b.block.last + 1, () => ({ column: 0, range: null }), 'scroll');
      return;
    }
    if (to < b.min) {
      if (!b.atBookStart) {
        void this.#navigate(b.block.first - 1, (f) => ({ column: frames.columns(f.index) - 1, range: null }), 'scroll');
      }
      return;
    }
    this.#motion.to(to * this.#pitch(), this.#reduced(), this.#pitch());
  }

  /** Continuous travel inside a hold (filmstrip): move the target, clamped to the loaded strip. */
  #drive(px: number): void {
    const b = this.#bounds();
    if (!b || this.#reduced()) return;
    const p = this.#pitch();
    this.#motion.to(clamp(this.#motion.target + px, b.min * p, b.max * p), false, p);
  }

  /**
   * End a hold: settle on the nearest page boundary, but never behind what is already on screen
   * (no bounce back against the direction of travel). The hold's first page was already taken.
   */
  #endHold(): void {
    const h = this.#hold;
    if (!h) return;
    this.#hold = null;
    const b = this.#bounds();
    if (!b) return;
    const p = this.#pitch();
    const seen = this.#motion.x / p;
    let col = this.#restColumn(b);
    col = h.dir > 0 ? Math.max(col, Math.ceil(seen - 1e-6)) : Math.min(col, Math.floor(seen + 1e-6));
    this.#motion.to(clamp(col, b.min, b.max) * p, this.#reduced(), p);
  }

  /** Every position change (animation frame or jump): rebase on the left page's section, place. */
  #apply(x: number): void {
    const frames = this.#frames;
    if (!frames || this.#base < 0 || !frames.frameAt(this.#base)) return;
    const p = this.#pitch();
    const block = frames.block(this.#base);
    const left = locateColumn(block, Math.floor(x / p + 1e-6));
    if (left.index !== this.#base) {
      this.#motion.shift(-(block.starts.get(left.index) ?? 0) * p);
      this.#base = left.index;
      x = this.#motion.x;
      this.#sectionChanged();
    }
    frames.place(this.#base, x);
  }

  /** The view came to rest on its target (step done, hold settled). */
  #settled(): void {
    if (this.#hold || !this.#frames) return;
    this.#reconcile();
    this.#emitRelocate('scroll');
  }

  #sectionChanged(): void {
    if (this.#base !== this.#section && this.#base >= 0) {
      this.#section = this.#base;
      this.#events.emit('section', { index: this.#base });
    }
    this.#reconcile();
  }

  /** Keep the sections the view shows (at its target) plus one neighbour on each side mounted. */
  #reconcile(): void {
    const frames = this.#frames;
    const b = this.#bounds();
    if (!frames || !b) return;
    const shown = visibleSections(b.block, this.#restColumn(b), frames.geometry.cols);
    const lo = Math.min(this.#base, ...shown) - 1;
    const hi = Math.max(this.#base, ...shown) + 1;
    const keep: number[] = [];
    for (let i = lo; i <= hi; i++) keep.push(i);
    frames.reconcile(keep, this.#pins.pinned);
  }

  #live(s: { index: number; range: Range } | null): { index: number; range: Range } | null {
    const f = s ? this.#frames?.frameAt(s.index) : null;
    return s && f?.doc && s.range.startContainer.ownerDocument === f.doc ? s : null;
  }

  /** The sticky target while it is on one of the pages of the view; else null. */
  #stickyShown(index: number, column: number): { index: number; range: Range } | null {
    const frames = this.#frames;
    const s = this.#live(this.#sticky);
    if (!frames || !s || s.index !== index) return null;
    const c = columnOfTarget(s.range, frames.geometry);
    return c !== null && c >= column && c < column + frames.geometry.cols ? s : null;
  }

  /** Locator source: the sticky target, else the first visible character of the left page. */
  #anchor(): Anchor {
    const frames = this.#frames!;
    const style = this.#style!;
    const b = this.#bounds();
    if (!b) return { index: Math.max(0, this.#base), range: null, viewportY: 0, fraction: 0 };
    const { index, column } = locateColumn(b.block, this.#restColumn(b));
    const fraction = column / Math.max(1, frames.columns(index));
    const sticky = this.#stickyShown(index, column);
    if (sticky) return { index, range: sticky.range, viewportY: 0, fraction };
    const f = frames.frameAt(index);
    const text = f?.text();
    if (!f?.doc || !text) return { index, range: null, viewportY: 0, fraction };
    const range = firstVisibleInColumn(f.doc, text, column, frames.geometry, style.lineHeightPx, style.fontSizePx);
    return { index, range, viewportY: 0, fraction };
  }

  /** Style, viewport or page-count change: capture, relayout, show the page holding the anchor. */
  #relayout(reason: RelocateReason | null): void {
    const frames = this.#frames;
    const style = this.#style;
    if (!frames || !style) return;
    const a = this.#bounds() ? this.#anchor() : null;
    // A held key / wheel stream survives a resize (F11, maximize while holding): it continues
    // from the relaid-out page. A running slide is finished: the view lands on its target page.
    const hold = this.#hold;
    this.#hold = null;
    this.#motion.stop();
    frames.applyStyle(style, style.pageGapPx);
    const cols = frames.geometry.cols;
    if (cols !== this.#shownPages) {
      this.#shownPages = cols;
      this.#events.emit('spread', { pagesPerView: cols, requested: this.#requested });
    }
    if (!a || !frames.frameAt(a.index)) return;
    const live = this.#live(a.range ? { index: a.index, range: a.range } : null);
    const column = live
      ? (columnOfTarget(live.range, frames.geometry) ?? 0)
      : Math.round(a.fraction * frames.columns(a.index));
    this.#sticky = live;
    this.#viewAnchor = live;
    this.#place(a.index, column);
    this.#hold = hold;
    if (reason) this.#emitRelocate(reason);
  }

  /** Instant placement: left page = `column` of ready section `index` (clamped at the book end). */
  #place(index: number, column: number): void {
    this.#hold = null;
    this.#base = index;
    const b = this.#bounds();
    if (!b) return;
    this.#motion.jump(clamp(column, b.min, b.max) * this.#pitch());
    this.#sectionChanged();
  }

  #emitRelocate(reason: RelocateReason): void {
    const frames = this.#frames;
    if (!frames || !this.#style || this.#base < 0) return;
    const a = this.#anchor();
    this.#viewAnchor = a.range ? { index: a.index, range: a.range } : null;
    const locator = locatorOf(frames, a, this.#sizes, this.#opts.locatorBridge, this.isAtEnd());
    const key = `${locator.sectionIndex}:${locator.charOffset}:${this.#base}:${Math.round(this.#motion.target)}`;
    // A step that did not move (book edge) or a resize that kept the page is not a new position.
    if ((reason === 'resize' || reason === 'scroll') && key === this.#lastKey) return;
    this.#lastKey = key;
    this.#events.emit('relocate', { locator, reason });
  }

  /** A mounted section re-paginated after load: keep the reported position in view. */
  #onReflow(f: SectionFrame): void {
    const frames = this.#frames;
    const b = this.#bounds();
    if (!frames || !b || this.#hold || this.#motion.active) return;
    const rest = locateColumn(b.block, this.#restColumn(b));
    if (f.index !== rest.index) return;
    const v = this.#live(this.#sticky) ?? this.#live(this.#viewAnchor);
    const column = v && v.index === f.index ? columnOfTarget(v.range, frames.geometry) : null;
    if (column !== null && column !== rest.column) this.#place(f.index, column);
  }

  async #goToLocator(loc: Locator, reason: RelocateReason): Promise<boolean> {
    if (isBookEnd(loc) && this.sectionCount > 0) {
      await this.#goToEdge(this.sectionCount - 1, 'end', reason);
      return true;
    }
    for (const attempt of locatorAttempts(loc, this.#sizes, this.#opts.locatorBridge)) {
      const a = attempt();
      if (!a || !(a[0] >= 0 && a[0] < this.sectionCount)) continue;
      const place = a[1];
      const r = await this.#navigate(
        a[0],
        (f) => {
          const p = place(f, 0);
          if (!p) return null;
          return { column: p.range ? (columnOfTarget(p.range, this.#g()) ?? 0) : 0, range: p.range };
        },
        reason,
      );
      if (r !== false) return true; // done, or superseded by a newer navigation
    }
    return false;
  }

  /**
   * Mount `index` (pinned meanwhile), then show the picked page instantly. 'stale' = superseded.
   * A step across an unloaded section boundary ('scroll') keeps a held key going from the new page.
   */
  async #navigate(index: number, pick: ColumnPick, reason: RelocateReason = 'goto'): Promise<boolean | 'stale'> {
    const frames = this.#frames;
    if (!frames) return false;
    const token = ++this.#nav;
    this.#pins.pin(index, 1);
    this.#navigating++;
    try {
      const f = await frames.ensureMounted(index);
      if (token !== this.#nav || this.#frames !== frames) return 'stale';
      if (!f) return false;
      const p = pick(f);
      if (!p) return false;
      this.#sticky = p.range ? { index, range: p.range } : null;
      const hold = reason === 'scroll' && this.#hold?.source === 'key' ? this.#hold : null;
      this.#place(index, p.column);
      this.#hold = hold;
      if (!hold) this.#emitRelocate(reason);
      return true;
    } finally {
      this.#navigating--;
      this.#pins.pin(index, -1);
    }
  }

  /**
   * Paged + 1 (and reduced motion): one page per wheel gesture. Filmstrip: a discrete event (a
   * mouse-wheel notch: line/page delta mode, or >= 20 px after a 40 ms pause) is one page step, so
   * notches at a normal cadence are a page each (rapid ones: lag cap, no queue). A streaming
   * gesture (touchpad, fast-spun wheel) moves the strip continuously with the travel (its first
   * event, or its first 40 px, take one page); 160 ms of quiet settles it on a page boundary.
   */
  #onWheel(e: WheelEvent): void {
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = performance.now();
    const gap = now - this.#lastWheel;
    this.#lastWheel = now;
    if (!this.#filmstrip || this.#reduced()) {
      const dir = this.#wheel.feed(d, e.deltaMode, now);
      if (dir !== 0) this.page(dir);
      return;
    }
    if (this.#hold?.source === 'key') return;
    const px = e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * this.getViewportHeight() : d;
    const dir = Math.sign(px) as -1 | 0 | 1;
    if (dir === 0) return;
    if (this.#hold && this.#hold.dir !== dir) this.#endWheel(); // reversed: settle, start over
    this.#armWheelEnd();
    if (e.deltaMode !== 0 || (gap > WHEEL_DISCRETE_GAP_MS && Math.abs(px) >= WHEEL_DISCRETE_MIN_PX)) {
      this.#wheelSum = 0;
      this.#hold = { dir, source: 'wheel' };
      this.#step(dir);
      return;
    }
    if (this.#hold) {
      this.#drive(px);
      return;
    }
    if (Math.sign(this.#wheelSum) !== dir) this.#wheelSum = 0;
    this.#wheelSum += px;
    if (Math.abs(this.#wheelSum) < WHEEL_START_PX) return;
    this.#wheelSum = 0;
    this.#endHold();
    this.#hold = { dir, source: 'wheel' };
    this.#step(dir);
  }

  #armWheelEnd(): void {
    window.clearTimeout(this.#wheelEnd);
    this.#wheelEnd = window.setTimeout(() => this.#endWheel(), WHEEL_QUIET_MS);
  }

  #endWheel(): void {
    window.clearTimeout(this.#wheelEnd);
    this.#wheelSum = 0;
    if (this.#hold?.source === 'wheel') this.#endHold();
  }

  /** Click zones (LM-03): left third of the reader = previous, right third = next. */
  #onClick(clientX: number): void {
    const root = this.#frames?.root;
    if (!root || this.#opts.clickZones === false) return;
    const box = root.getBoundingClientRect();
    const dir = clickZone(clientX, box.left, box.width);
    if (dir !== 0) this.page(dir);
  }

  #onLink(f: SectionFrame, raw: string): void {
    const link = resolveLink(this.#book, f.index, raw);
    if (!link) return;
    if ('external' in link) this.#opts.onExternalLink?.(link.external);
    else void this.goTo({ href: link.href });
  }
}
