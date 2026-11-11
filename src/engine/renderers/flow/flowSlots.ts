/**
 * The flow track: one scroll container holding one slot per section (PRD §10.4 step 4).
 * Owns slot DOM, mounting/unmounting of section iframes, height estimation and scroll anchoring.
 * FlowRenderer owns navigation, locators and events.
 */
import type { BookSource } from '../../book/BookSource';
import type { CompiledStyle } from '../../style/types';
import { anchorCorrection, columnWidth, separatorHeight, type AnchorState } from './flowMath';
import { frameBaseCss } from './frameCss';
import { HeightEstimator, priorPxPerUnit, rescaleHeight } from './heightEstimator';
import { SectionFrame, type FrameHooks } from './sectionFrame';
import { rangeTop } from './sectionText';
import { SlotLayout } from './slotLayout';
import { planMounts, type SlotWindow } from './slotWindow';

/** A text position inside a mounted section that must not move on screen when layout changes. */
export interface TextAnchor {
  index: number;
  range: Range;
  /** Last known top of `range` in the section document (px). */
  docY: number;
}

export interface FlowSlotsHooks {
  frame: Omit<FrameHooks, 'onContentResize'>;
  onSectionReady(frame: SectionFrame): void;
  onLayoutChanged(): void;
  /** false = `overflow-anchor: none`, manual correction only (spike A/B switch, ADR-001). */
  nativeAnchoring: boolean;
}

/** Spike/perf-overlay counters: did native CSS anchoring handle a change, or did we correct? */
export interface AnchorStats {
  commits: number;
  nativeHandled: number;
  manualCorrections: number;
  lastResidualPx: number;
}

interface Slot {
  el: HTMLDivElement;
  frame: SectionFrame | null;
  ready: Promise<SectionFrame | null> | null;
  failed: boolean;
  acquired: boolean;
  domH: number;
}

/** Ratio change that triggers re-estimating every never-measured slot. */
const REESTIMATE_THRESHOLD = 0.1;

export class FlowSlots {
  readonly scroller: HTMLDivElement;
  readonly track: HTMLDivElement;
  readonly layout: SlotLayout;
  readonly stats: AnchorStats = {
    commits: 0,
    nativeHandled: 0,
    manualCorrections: 0,
    lastResidualPx: 0,
  };
  textAnchor: TextAnchor | null = null;
  #book: BookSource;
  #hooks: FlowSlotsHooks;
  #frameHooks: FrameHooks;
  #slots: Slot[] = [];
  #est = new HeightEstimator(1);
  #style: CompiledStyle;
  #colW = 0;
  #baseCss = '';
  #lastRatio = 0;
  #unitsPerChar: number;

  constructor(host: HTMLElement, book: BookSource, style: CompiledStyle, hooks: FlowSlotsHooks) {
    this.#book = book;
    this.#hooks = hooks;
    this.#style = style;
    this.#unitsPerChar = book.format === 'txt' ? 1 : 2;
    this.#frameHooks = { ...hooks.frame, onContentResize: (f) => this.#onContentResize(f) };

    const sc = document.createElement('div');
    sc.className = 'er-flow';
    Object.assign(sc.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollBehavior: 'auto',
      scrollSnapType: 'none',
      // Manual-only by default: no deferred browser correction after an animation.
      overflowAnchor: hooks.nativeAnchoring ? 'auto' : 'none',
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
      outline: 'none',
    });
    const track = document.createElement('div');
    track.className = 'er-flow-track';
    track.style.boxSizing = 'content-box';
    const n = book.sections.length;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'er-flow-slot';
      el.dataset.index = String(i);
      Object.assign(el.style, {
        position: 'relative',
        overflow: 'hidden',
        contain: 'layout paint',
      });
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'er-flow-sep';
        sep.setAttribute('aria-hidden', 'true');
        Object.assign(sep.style, {
          height: 'var(--er-sep-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        });
        const rule = document.createElement('div');
        Object.assign(rule.style, {
          width: '96px',
          height: '1px',
          background: 'var(--er-sep-color)',
        });
        sep.append(rule);
        el.append(sep);
      }
      track.append(el);
      this.#slots.push({ el, frame: null, ready: null, failed: false, acquired: false, domH: -1 });
    }
    sc.append(track);
    host.append(sc);
    this.scroller = sc;
    this.track = track;
    this.layout = new SlotLayout(n, { padTop: 0, padBottom: 0, separatorPx: 0 });
    this.applyStyle(style);
  }

  get columnWidthPx(): number {
    return this.#colW;
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

  mountedIndices(): number[] {
    const out: number[] = [];
    this.#slots.forEach((s, i) => {
      if (s.frame) out.push(i);
    });
    return out;
  }

  #minContent(): number {
    return Math.round(2 * this.#style.lineHeightPx);
  }

  /**
   * Apply a style or viewport change: geometry, CSS in mounted documents, re-measure them, rescale
   * remembered heights and re-estimate the rest. Does NOT restore the reading position; the caller
   * captures an anchor before and restores it after.
   */
  applyStyle(style: CompiledStyle): void {
    this.#style = style;
    const sc = this.scroller;
    const vw = sc.clientWidth;
    const vh = sc.clientHeight;
    this.#colW = columnWidth(vw, style.marginXPx, style.maxLineWidthPx);
    const sep = separatorHeight(style.lineHeightPx);
    const pad = Math.round(style.marginYPx);
    this.layout.setGeometry({ padTop: pad, padBottom: pad, separatorPx: sep });
    sc.style.background = style.background;
    this.track.style.padding = `${pad}px 0`;
    this.track.style.setProperty('--er-sep-h', `${sep}px`);
    this.track.style.setProperty(
      '--er-sep-color',
      `color-mix(in srgb, ${style.foreground} 22%, transparent)`,
    );
    this.#baseCss = frameBaseCss({ mediaMaxHeightPx: vh - 2 * pad });

    const oldRatio = this.#est.pxPerUnit;
    this.#est.reset(
      priorPxPerUnit({
        columnWidthPx: this.#colW,
        fontSizePx: style.fontSizePx,
        lineHeightPx: style.lineHeightPx,
        unitsPerChar: this.#unitsPerChar,
      }),
    );
    const ready = this.#slots.flatMap((s) => (s.frame?.ready ? [s.frame] : []));
    for (const f of ready) {
      f.applyCss(this.#baseCss, style.css);
      f.setWidth(this.#colW);
    }
    for (const f of ready) {
      const h = f.measure();
      this.layout.setContentHeight(f.index, h, true);
      this.#est.observe(f.index, this.sizeOf(f.index), h);
    }
    const newRatio = this.#est.pxPerUnit;
    const minH = this.#minContent();
    for (let i = 0; i < this.#slots.length; i++) {
      if (this.#slots[i]!.frame?.ready) continue;
      const h = this.layout.isMeasured(i)
        ? rescaleHeight(this.layout.contentHeight(i), oldRatio, newRatio, minH)
        : this.#est.estimate(this.sizeOf(i), minH);
      this.layout.setContentHeight(i, h, this.layout.isMeasured(i));
    }
    this.#lastRatio = newRatio;
    this.#writeHeights();
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

  /** Re-estimate never-measured slots when the learned ratio moved by more than 10 %. */
  #reestimate(): boolean {
    const r = this.#est.pxPerUnit;
    if (this.#lastRatio > 0 && Math.abs(r / this.#lastRatio - 1) < REESTIMATE_THRESHOLD)
      return false;
    this.#lastRatio = r;
    const minH = this.#minContent();
    let changed = false;
    for (let i = 0; i < this.#slots.length; i++) {
      if (this.layout.isMeasured(i)) continue;
      changed =
        this.layout.setContentHeight(i, this.#est.estimate(this.sizeOf(i), minH), false) || changed;
    }
    return changed;
  }

  /**
   * Apply measured heights while keeping the reading position still (LM-01 anchoring).
   * Manual-only by default. The optional native A/B mode still corrects only the residual.
   * This runs only on real layout changes, never on animation completion or scroll settle.
   */
  #commit(changes: Array<{ index: number; h: number }>): void {
    const sc = this.scroller;
    const st = sc.scrollTop;
    const a = Math.max(0, this.layout.indexAt(st));
    const ta = this.textAnchor && this.textAnchor.index === a ? this.textAnchor : null;
    const ct0 = this.layout.contentTop(a);
    const before: AnchorState = { contentTop: ct0, innerY: ta ? ta.docY : st - ct0, scrollTop: st };
    let changed = false;
    for (const c of changes) {
      changed = this.layout.setContentHeight(c.index, c.h, true) || changed;
      this.#est.observe(c.index, this.sizeOf(c.index), c.h);
    }
    changed = this.#reestimate() || changed;
    if (!changed) return;
    this.#writeHeights();
    const innerAfter = ta ? (rangeTop(ta.range) ?? ta.docY) : before.innerY;
    const stNow = sc.scrollTop; // forces layout, includes any native anchoring adjustment
    const after: AnchorState = {
      contentTop: this.layout.contentTop(a),
      innerY: innerAfter,
      scrollTop: stNow,
    };
    const d = anchorCorrection(before, after);
    const needed = after.contentTop + innerAfter - (before.contentTop + before.innerY);
    this.stats.commits++;
    if (Math.abs(needed) >= 0.5) {
      if (d === 0) this.stats.nativeHandled++;
      else this.stats.manualCorrections++;
    }
    this.stats.lastResidualPx = d;
    if (d !== 0) sc.scrollTop = stNow + d;
    if (ta) ta.docY = innerAfter;
    this.#hooks.onLayoutChanged();
  }

  #onContentResize(f: SectionFrame): void {
    if (!f.ready || this.#slots[f.index]?.frame !== f) return;
    const h = f.measure();
    if (h !== this.layout.contentHeight(f.index) || !this.layout.isMeasured(f.index)) {
      this.#commit([{ index: f.index, h }]);
    }
  }

  /** Resolves with the ready frame, or null if it failed or was unmounted meanwhile. */
  ensureMounted(i: number, maxMounted = 5): Promise<SectionFrame | null> {
    const s = this.#slots[i];
    if (!s || s.failed) return Promise.resolve(null);
    if (s.frame?.ready) return Promise.resolve(s.frame);
    if (!s.frame) {
      const mounted = this.mountedIndices().sort((a, b) => Math.abs(b - i) - Math.abs(a - i));
      while (mounted.length >= Math.max(1, maxMounted)) this.#unmount(mounted.shift()!);
    }
    return s.ready ?? this.#mount(i);
  }

  #mount(i: number): Promise<SectionFrame | null> {
    const s = this.#slots[i]!;
    const section = this.#book.sections[i]!;
    const frame = new SectionFrame(i, this.#frameHooks);
    frame.setHeight(this.layout.contentHeight(i));
    s.frame = frame;
    s.el.append(frame.iframe);
    const run = async (): Promise<SectionFrame | null> => {
      let url: string;
      try {
        url = await section.load();
      } catch (e) {
        console.warn(`[FlowRenderer] section ${i} failed to load`, e);
        return this.#fail(i, frame);
      }
      if (s.frame !== frame) {
        section.unload();
        return null;
      }
      s.acquired = true;
      try {
        await frame.load(url, this.#colW, this.#baseCss, this.#style.css);
      } catch (e) {
        if (s.frame !== frame) return null;
        console.warn(`[FlowRenderer] section ${i} failed to render`, e);
        return this.#fail(i, frame);
      }
      if (s.frame !== frame) return null;
      frame.applyCss(this.#baseCss, this.#style.css); // style may have changed while loading
      frame.setWidth(this.#colW);
      frame.show();
      this.#commit([{ index: i, h: frame.measure() }]);
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
    f.destroy(); // keeps the slot height: the remembered measurement stays in the layout
    if (s.acquired) {
      s.acquired = false;
      try {
        this.#book.sections[i]?.unload();
      } catch (e) {
        console.warn(`[FlowRenderer] section ${i} unload failed`, e);
      }
    }
    if (this.textAnchor?.index === i) this.textAnchor = null;
  }

  /** Mount the window, unmount what falls outside it (with hysteresis), never touching pinned slots. */
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
