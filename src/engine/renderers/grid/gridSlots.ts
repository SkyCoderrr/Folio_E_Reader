/**
 * The page-grid track (ADR-002): one scroll container holding one slot per section. A slot is
 * `rows × rowH` tall (every section starts on a new row), holding one wrapped-multicol section
 * iframe when mounted, or nothing (a spacer of remembered/estimated rows) when not.
 *
 * Same model as flow/flowSlots.ts (SlotLayout, HeightEstimator, slotWindow, SectionFrame,
 * anchorCorrection are imported, not copied) with three differences: no chapter separators or
 * track padding, heights are quantized to whole rows, and the scroll anchor is row-relative
 * (a reflow that moves the anchor text to the other page of the same row does not scroll).
 */
import type { BookSource } from '../../book/BookSource';
import type { CompiledStyle } from '../../style/types';
import { anchorCorrection, type AnchorState } from '../flow/flowMath';
import type { AnchorStats, TextAnchor } from '../flow/flowSlots';
import { HeightEstimator, priorPxPerUnit, rescaleHeight } from '../flow/heightEstimator';
import { SectionFrame, type FrameHooks } from '../flow/sectionFrame';
import { rangeTop } from '../flow/sectionText';
import { SlotLayout } from '../flow/slotLayout';
import { planMounts, type SlotWindow } from '../flow/slotWindow';
import { deskColors, deskLayers } from './deskColors';
import { gridFrameCss } from './gridCss';
import {
  DEFAULT_MIN_SPREAD_WIDTH_PX,
  effectivePages,
  gridGeometry,
  gridPxPerUnit,
  rowOf,
  rowsForHeight,
  snapToRows,
  type GridGeometry,
} from './gridMath';
import type { PageGridDebugStats } from './gridParts';

export interface GridSlotsHooks {
  frame: Omit<FrameHooks, 'onContentResize'>;
  onSectionReady(frame: SectionFrame): void;
  onLayoutChanged(): void;
}

interface Slot {
  el: HTMLDivElement;
  frame: SectionFrame | null;
  ready: Promise<SectionFrame | null> | null;
  failed: boolean;
  acquired: boolean;
  domH: number;
}

const REESTIMATE_THRESHOLD = 0.1;


export class GridSlots {
  readonly scroller: HTMLDivElement;
  readonly track: HTMLDivElement;
  readonly layout: SlotLayout;
  readonly stats: AnchorStats = { commits: 0, nativeHandled: 0, manualCorrections: 0, lastResidualPx: 0 };
  textAnchor: TextAnchor | null = null;
  #book: BookSource;
  #hooks: GridSlotsHooks;
  #frameHooks: FrameHooks;
  #slots: Slot[] = [];
  #est = new HeightEstimator(1);
  #style: CompiledStyle;
  #gap: number;
  #g: GridGeometry;
  #css = '';
  #lastRatio = 0;
  #unitsPerChar: number;
  /** layout.minSpreadWidthPx: below this viewport width rows hold one page (narrow fallback). */
  minSpreadWidthPx = DEFAULT_MIN_SPREAD_WIDTH_PX;

  constructor(
    host: HTMLElement,
    book: BookSource,
    style: CompiledStyle,
    gapPx: number,
    hooks: GridSlotsHooks,
    minSpreadWidthPx: number = DEFAULT_MIN_SPREAD_WIDTH_PX,
  ) {
    this.minSpreadWidthPx = minSpreadWidthPx;
    this.#book = book;
    this.#hooks = hooks;
    this.#style = style;
    this.#gap = gapPx;
    this.#unitsPerChar = book.format === 'txt' ? 1 : 2;
    this.#frameHooks = { ...hooks.frame, onContentResize: (f) => this.#onContentResize(f) };

    const sc = document.createElement('div');
    sc.className = 'er-grid';
    Object.assign(sc.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollBehavior: 'auto',
      scrollSnapType: 'none',
      overflowAnchor: 'none', // manual row-relative anchoring only (see #commit)
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
      outline: 'none',
    });
    const track = document.createElement('div');
    track.className = 'er-grid-track';
    track.style.position = 'relative';
    const n = book.sections.length;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'er-grid-slot';
      el.dataset.index = String(i);
      Object.assign(el.style, { position: 'relative', overflow: 'hidden', contain: 'layout paint' });
      // Page edges drawn above the iframe: desk sides and gutter, 1 px page edges (M6.2).
      const edges = document.createElement('div');
      edges.className = 'er-grid-edges';
      edges.setAttribute('aria-hidden', 'true');
      Object.assign(edges.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
      el.append(edges);
      track.append(el);
      this.#slots.push({ el, frame: null, ready: null, failed: false, acquired: false, domH: -1 });
    }
    sc.append(track);
    host.append(sc);
    this.scroller = sc;
    this.track = track;
    this.layout = new SlotLayout(n, { padTop: 0, padBottom: 0, separatorPx: 0 });
    this.#g = gridGeometry({ viewportW: 0, viewportH: 1, gapPx: 0, marginXPx: 0, marginYPx: 0, maxLineWidthPx: null });
    this.applyStyle(style, gapPx);
  }

  get geometry(): GridGeometry {
    return this.#g;
  }

  get pxPerUnit(): number {
    return this.#est.pxPerUnit;
  }

  sizeOf(i: number): number {
    return Math.max(0, this.#book.sections[i]?.size ?? 0);
  }

  frameAt(i: number): SectionFrame | null {
    const f = this.#slots[i]?.frame;
    return f && f.ready ? f : null;
  }

  debugStats(sticky: boolean): PageGridDebugStats {
    const anchoring = { ...this.stats };
    return { mounted: this.mountedIndices(), pxPerUnit: this.pxPerUnit, anchoring, geometry: { ...this.#g }, sticky };
  }

  mountedIndices(): number[] {
    const out: number[] = [];
    this.#slots.forEach((s, i) => {
      if (s.frame) out.push(i);
    });
    return out;
  }

  /** Measured section height, quantized to rows. */
  #measureRows(f: SectionFrame): number {
    return rowsForHeight(f.measure(), this.#g.rowH) * this.#g.rowH;
  }

  /**
   * Apply a style, gap or viewport change: geometry, CSS in mounted documents, re-measure them,
   * rescale remembered heights, re-estimate the rest. The caller captures and restores the anchor.
   */
  applyStyle(style: CompiledStyle, gapPx: number = this.#gap): void {
    this.#style = style;
    this.#gap = gapPx;
    const sc = this.scroller;
    const g = gridGeometry({
      cols: effectivePages(2, sc.clientWidth, this.minSpreadWidthPx),
      viewportW: sc.clientWidth,
      viewportH: sc.clientHeight,
      gapPx,
      marginXPx: style.marginXPx,
      marginYPx: style.marginYPx,
      maxLineWidthPx: style.maxLineWidthPx,
    });
    this.#g = g;
    this.#css = gridFrameCss(g);
    this.#paintEdges(style, g);

    const oldRatio = this.#est.pxPerUnit;
    const flowPrior = priorPxPerUnit({
      columnWidthPx: g.textW,
      fontSizePx: style.fontSizePx,
      lineHeightPx: style.lineHeightPx,
      unitsPerChar: this.#unitsPerChar,
    });
    this.#est.reset(gridPxPerUnit(flowPrior, g));
    const ready = this.#slots.flatMap((s) => (s.frame?.ready ? [s.frame] : []));
    for (const f of ready) this.#place(f);
    for (const f of ready) {
      const h = this.#measureRows(f);
      this.layout.setContentHeight(f.index, h, true);
      this.#est.observe(f.index, this.sizeOf(f.index), h);
    }
    const newRatio = this.#est.pxPerUnit;
    for (let i = 0; i < this.#slots.length; i++) {
      if (this.#slots[i]!.frame?.ready) continue;
      const h = this.layout.isMeasured(i)
        ? rescaleHeight(this.layout.contentHeight(i), oldRatio, newRatio, g.rowH)
        : this.#est.estimate(this.sizeOf(i), g.rowH);
      this.layout.setContentHeight(i, snapToRows(h, g.rowH), this.layout.isMeasured(i));
    }
    this.#lastRatio = newRatio;
    this.#writeHeights();
  }

  #place(f: SectionFrame): void {
    f.applyCss(this.#css, this.#style.css);
    f.setWidth(this.#g.frameW);
    f.iframe.style.margin = '0';
    f.iframe.style.position = 'absolute';
    f.iframe.style.top = '0';
    f.iframe.style.left = `${this.#g.frameLeft}px`;
  }

  /**
   * Desk (sides and gutter) and 1 px page edges, from deskColors (PRD §6.7). One-page rows
   * (narrow fallback) span the viewport, so only their row edges show.
   */
  #paintEdges(style: CompiledStyle, g: GridGeometry): void {
    const c = deskColors(style);
    this.scroller.style.background = c.desk;
    const pages = [{ x: g.spreadLeft, width: g.pageW }];
    if (g.cols === 2) pages.push({ x: g.spreadLeft + g.pageW + g.gapPx, width: g.pageW });
    const layers = deskLayers(c, pages, this.scroller.clientWidth, g.rowH, g.gapPx);
    for (const s of this.#slots) {
      s.el.style.background = c.page;
      const edges = s.el.firstElementChild as HTMLElement | null;
      if (edges) Object.assign(edges.style, layers);
    }
  }

  #writeHeights(): void {
    for (let i = 0; i < this.#slots.length; i++) {
      const s = this.#slots[i]!;
      const h = this.layout.slotHeight(i);
      if (s.domH !== h) {
        s.el.style.height = `${h}px`;
        s.domH = h;
      }
      s.frame?.setHeight(this.layout.contentHeight(i));
    }
  }

  #reestimate(): boolean {
    const r = this.#est.pxPerUnit;
    if (this.#lastRatio > 0 && Math.abs(r / this.#lastRatio - 1) < REESTIMATE_THRESHOLD) return false;
    this.#lastRatio = r;
    const rowH = this.#g.rowH;
    let changed = false;
    for (let i = 0; i < this.#slots.length; i++) {
      if (this.layout.isMeasured(i)) continue;
      const h = snapToRows(this.#est.estimate(this.sizeOf(i), rowH), rowH);
      changed = this.layout.setContentHeight(i, h, false) || changed;
    }
    return changed;
  }

  /**
   * Apply measured heights while keeping the reading row still. The anchor is the row (not the
   * line) holding the text anchor, so corrections are whole rows and the view stays row-aligned.
   */
  #commit(changes: Array<{ index: number; h: number }>): void {
    const sc = this.scroller;
    const rowH = this.#g.rowH;
    const st = sc.scrollTop;
    const a = Math.max(0, this.layout.indexAt(st));
    const ta = this.textAnchor && this.textAnchor.index === a ? this.textAnchor : null;
    const ct0 = this.layout.contentTop(a);
    const rowTop = (docY: number): number => rowOf(docY, rowH) * rowH;
    const before: AnchorState = { contentTop: ct0, innerY: ta ? rowTop(ta.docY) : st - ct0, scrollTop: st };
    let changed = false;
    for (const c of changes) {
      changed = this.layout.setContentHeight(c.index, c.h, true) || changed;
      this.#est.observe(c.index, this.sizeOf(c.index), c.h);
    }
    changed = this.#reestimate() || changed;
    // Row quantization hides many reflows (fonts loading): the height stays, but the anchor text
    // may move to another row. Correct that too.
    const docNow = ta ? (rangeTop(ta.range) ?? ta.docY) : null;
    const moved = ta !== null && docNow !== null && rowTop(docNow) !== rowTop(ta.docY);
    if (!changed && !moved) return;
    this.#writeHeights();
    const docAfter = ta ? (rangeTop(ta.range) ?? ta.docY) : null;
    const innerAfter = docAfter !== null ? rowTop(docAfter) : before.innerY;
    const stNow = sc.scrollTop;
    const after: AnchorState = { contentTop: this.layout.contentTop(a), innerY: innerAfter, scrollTop: stNow };
    const d = anchorCorrection(before, after);
    this.stats.commits++;
    if (d !== 0) this.stats.manualCorrections++;
    this.stats.lastResidualPx = d;
    if (d !== 0) sc.scrollTop = stNow + d;
    if (ta && docAfter !== null) ta.docY = docAfter;
    this.#hooks.onLayoutChanged();
  }

  #onContentResize(f: SectionFrame): void {
    if (!f.ready || this.#slots[f.index]?.frame !== f) return;
    // Always commit: even with an unchanged row count the anchor text may have changed rows.
    this.#commit([{ index: f.index, h: this.#measureRows(f) }]);
  }

  ensureMounted(i: number): Promise<SectionFrame | null> {
    const s = this.#slots[i];
    if (!s || s.failed) return Promise.resolve(null);
    if (s.frame?.ready) return Promise.resolve(s.frame);
    return s.ready ?? this.#mount(i);
  }

  #mount(i: number): Promise<SectionFrame | null> {
    const s = this.#slots[i]!;
    const section = this.#book.sections[i]!;
    const frame = new SectionFrame(i, this.#frameHooks);
    frame.setHeight(this.layout.contentHeight(i));
    frame.iframe.style.position = 'absolute';
    frame.iframe.style.top = '0';
    frame.iframe.style.left = `${this.#g.frameLeft}px`;
    frame.iframe.style.margin = '0';
    s.frame = frame;
    s.el.insertBefore(frame.iframe, s.el.firstChild); // below the edges overlay
    const run = async (): Promise<SectionFrame | null> => {
      let url: string;
      try {
        url = await section.load();
      } catch (e) {
        console.warn(`[PageGridRenderer] section ${i} failed to load`, e);
        return this.#fail(i, frame);
      }
      if (s.frame !== frame) {
        section.unload();
        return null;
      }
      s.acquired = true;
      try {
        await frame.load(url, this.#g.frameW, this.#css, this.#style.css);
      } catch (e) {
        if (s.frame !== frame) return null;
        console.warn(`[PageGridRenderer] section ${i} failed to render`, e);
        return this.#fail(i, frame);
      }
      if (s.frame !== frame) return null;
      this.#place(frame); // style or viewport may have changed while loading
      frame.show();
      this.#commit([{ index: i, h: this.#measureRows(frame) }]);
      this.#hooks.onSectionReady(frame);
      return frame;
    };
    const p = run();
    s.ready = p;
    return p;
  }

  #fail(i: number, frame: SectionFrame): null {
    const s = this.#slots[i]!;
    if (s.frame === frame) {
      s.failed = true;
      this.#unmount(i);
    }
    return null;
  }

  #unmount(i: number): void {
    const s = this.#slots[i];
    if (!s?.frame) return;
    const f = s.frame;
    s.frame = null;
    s.ready = null;
    f.destroy();
    if (s.acquired) {
      s.acquired = false;
      try {
        this.#book.sections[i]?.unload();
      } catch (e) {
        console.warn(`[PageGridRenderer] section ${i} unload failed`, e);
      }
    }
    if (this.textAnchor?.index === i) this.textAnchor = null;
  }

  reconcile(win: SlotWindow, pinned: ReadonlySet<number>, maxMounted: number): void {
    const plan = planMounts(this.mountedIndices(), win, pinned, maxMounted);
    for (const i of plan.unmount) this.#unmount(i);
    for (const i of plan.mount) if (!this.#slots[i]!.failed) void this.#mount(i);
  }

  destroy(): void {
    for (let i = 0; i < this.#slots.length; i++) this.#unmount(i);
    this.#slots = [];
    this.textAnchor = null;
    this.scroller.remove();
  }
}
