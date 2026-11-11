/**
 * Mounted section frames for PaginatorRenderer (ADR-004, ADR-005). The visible sections and their
 * neighbours are mounted and measured, and their iframes sit end to end as one horizontal strip of
 * columns (stripMath.ts), so a page step - also across a chapter boundary - only moves transforms.
 *
 *   root (fills the host; plain page background, nothing else is ever painted behind the text)
 *    └ clip (absolute; one page: the text column plus overhang; two pages: the full width)
 *       └ iframe per mounted section (absolute; width = its columns; translate3d(strip position))
 * t24u: the former two-page "paper" layer (desk-coloured gutter between page rectangles) is gone.
 * The section documents are opaque, so it only showed in the page margins above/below the text
 * (two small grey tabs at top/bottom centre) and as a vertical bar over empty pages while a
 * renderer was mounting (Paged <-> Scroll switch).
 */
import type { BookSource } from '../../book/BookSource';
import type { CompiledStyle } from '../../style/types';
import { SectionFrame, type FrameHooks } from '../flow/sectionFrame';
import { contentRight } from './pagedAnchor';
import { pagedFrameCss } from './pagedCss';
import { columnsForRight, pagedGeometry, stripFrameWidth, type PagedGeometry } from './pagedMath';
import { stripBlock, type StripBlock } from './stripMath';

export interface PagedFramesHooks {
  frame: Omit<FrameHooks, 'onContentResize'>;
  /** A section finished loading, was measured and has the reading style applied. */
  onSectionReady(frame: SectionFrame): void;
  /** A mounted section's column count changed after load (fonts, images, late reflow). */
  onReflow(frame: SectionFrame): void;
  /** Plain primary click inside a section document, in host client coordinates. */
  onClick(clientX: number, e: MouseEvent): void;
}

interface Mounted {
  frame: SectionFrame;
  ready: Promise<SectionFrame | null>;
  acquired: boolean;
  columns: number;
  off: Array<() => void>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class PagedFrames {
  readonly root: HTMLDivElement;
  readonly clip: HTMLDivElement;
  #book: BookSource;
  #hooks: PagedFramesHooks;
  #frameHooks: FrameHooks;
  #mounted = new Map<number, Mounted>();
  #failed = new Set<number>();
  #style: CompiledStyle;
  #g: PagedGeometry;
  #css = '';
  /** Strip placement: base section, and the view's left edge in px from the base's first column. */
  #base = -1;
  #x = 0;
  /** iframe left inside the clip (= where column 0's text starts). */
  #frameOffset = 0;
  #reflowRaf = new Map<number, number>();
  /** Effective pages per view for a viewport width (narrow-window fallback lives in the caller). */
  #colsFor: (viewportW: number) => 1 | 2;

  constructor(
    host: HTMLElement,
    book: BookSource,
    style: CompiledStyle,
    gapPx: number,
    colsFor: (viewportW: number) => 1 | 2,
    hooks: PagedFramesHooks,
  ) {
    this.#colsFor = colsFor;
    this.#book = book;
    this.#hooks = hooks;
    this.#style = style;
    this.#frameHooks = { ...hooks.frame, onContentResize: (f) => this.#scheduleReflow(f) };
    const root = document.createElement('div');
    root.className = 'er-paged';
    Object.assign(root.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      outline: 'none',
      overscrollBehavior: 'contain',
    });
    const clip = document.createElement('div');
    clip.className = 'er-paged-clip';
    Object.assign(clip.style, { position: 'absolute', overflow: 'hidden', contain: 'layout paint' });
    root.append(clip);
    host.append(root);
    this.root = root;
    this.clip = clip;
    this.#g = pagedGeometry({ viewportW: 0, viewportH: 1, gapPx: 0, marginXPx: 0, marginYPx: 0, maxLineWidthPx: null, cols: 1 });
    this.applyStyle(style, gapPx);
  }

  get geometry(): PagedGeometry {
    return this.#g;
  }

  /** Last placement: base section, and the view's left edge in px from its first column. */
  get placed(): { base: number; x: number } {
    return { base: this.#base, x: this.#x };
  }

  frameAt(i: number): SectionFrame | null {
    const f = this.#mounted.get(i)?.frame;
    return f && f.ready ? f : null;
  }

  /** Columns (pages) of a ready section (1 when not mounted). */
  columns(i: number): number {
    const m = this.#mounted.get(i);
    return m && m.frame.ready ? Math.max(1, m.columns) : 1;
  }

  /** Contiguous ready sections around `base`, laid end to end (base must be ready). */
  block(base: number): StripBlock {
    return stripBlock(base, (i) => this.frameAt(i) !== null, (i) => this.columns(i), this.#book.sections.length);
  }

  mountedIndices(): number[] {
    return [...this.#mounted.keys()].sort((a, b) => a - b);
  }

  /**
   * Apply a style, gap, viewport or pages-per-view change: geometry, CSS in mounted documents,
   * re-measure them. The caller captures and restores the reading position.
   */
  applyStyle(style: CompiledStyle, gapPx: number): void {
    this.#style = style;
    const r = this.root;
    const cols = this.#colsFor(r.clientWidth);
    const g = pagedGeometry({
      viewportW: r.clientWidth,
      viewportH: r.clientHeight,
      gapPx,
      marginXPx: style.marginXPx,
      marginYPx: style.marginYPx,
      maxLineWidthPx: style.maxLineWidthPx,
      cols,
      lineHeightPx: style.lineHeightPx,
    });
    this.#g = g;
    this.#css = pagedFrameCss(g);
    // Two pages: the clip spans the whole width, so pages slide in from / out to the window edges
    // (the two pages fill the width, so neighbouring text is off-screen at rest). One page: the
    // text column plus overhang, so neighbouring columns never show in the margins.
    const clipLeft = g.cols === 2 ? 0 : g.clipLeft;
    this.#frameOffset = g.frameLeft - clipLeft;
    Object.assign(this.clip.style, {
      left: `${clipLeft}px`,
      top: `${g.marginY}px`,
      width: `${g.cols === 2 ? Math.max(0, r.clientWidth) : g.clipW}px`,
      height: `${g.textH}px`,
    });
    this.root.style.backgroundColor = style.background;
    for (const m of this.#mounted.values()) {
      this.#size(m);
      if (!m.frame.ready) continue;
      m.frame.applyCss(this.#css, style.css);
      this.#measure(m);
    }
    this.#placeAll();
  }

  /**
   * Place the strip: the view's left edge is `x` px from the first column of section `base` (which
   * must be ready). Transform writes only; sections outside the view are hidden.
   */
  place(base: number, x: number): void {
    this.#base = base;
    this.#x = x;
    this.#placeAll();
  }

  #placeAll(): void {
    const g = this.#g;
    const base = this.#base;
    const block = base >= 0 && this.frameAt(base) ? this.block(base) : null;
    const x = this.#x;
    const viewW = g.cols * g.pitch;
    for (const [i, m] of this.#mounted) {
      if (!m.frame.ready) continue;
      const st = m.frame.iframe.style;
      const start = block?.starts.get(i);
      if (start === undefined) {
        st.visibility = 'hidden';
        continue;
      }
      const left = start * g.pitch - x;
      const shown = left < viewW && left + this.columns(i) * g.pitch > 0;
      st.visibility = shown ? 'visible' : 'hidden';
      st.transform = `translate3d(${round2(left)}px, 0, 0)`;
    }
  }

  ensureMounted(i: number): Promise<SectionFrame | null> {
    if (i < 0 || i >= this.#book.sections.length || this.#failed.has(i)) return Promise.resolve(null);
    const m = this.#mounted.get(i);
    if (m) return m.ready;
    return this.#mount(i);
  }

  /** Keep exactly `keep` (plus `pinned`) mounted: unmount the rest, start loading the missing. */
  reconcile(keep: number[], pinned: ReadonlySet<number>): void {
    const want = new Set(keep.filter((i) => i >= 0 && i < this.#book.sections.length));
    for (const i of [...this.#mounted.keys()]) if (!want.has(i) && !pinned.has(i)) this.#unmount(i);
    for (const i of want) if (!this.#mounted.has(i) && !this.#failed.has(i)) void this.#mount(i);
  }

  /** Re-measure a ready section now; true when its column count changed. */
  remeasure(i: number): boolean {
    const m = this.#mounted.get(i);
    if (!m || !m.frame.ready) return false;
    const before = m.columns;
    this.#measure(m);
    this.#placeAll();
    return m.columns !== before;
  }

  #measure(m: Mounted): void {
    const doc = m.frame.doc;
    if (!doc) return;
    const se = doc.scrollingElement;
    if (se && (se.scrollLeft !== 0 || se.scrollTop !== 0)) {
      se.scrollLeft = 0;
      se.scrollTop = 0;
    }
    const g = this.#g;
    m.columns = columnsForRight(contentRight(doc), g.pitch);
    this.#size(m);
  }

  #size(m: Mounted): void {
    const g = this.#g;
    const st = m.frame.iframe.style;
    st.position = 'absolute';
    st.top = '0';
    st.left = `${this.#frameOffset}px`;
    st.margin = '0';
    st.transition = 'none';
    st.willChange = 'transform';
    m.frame.setHeight(g.textH);
    m.frame.setWidth(stripFrameWidth(m.columns, g));
  }

  #scheduleReflow(f: SectionFrame): void {
    if (this.#reflowRaf.has(f.index)) return;
    this.#reflowRaf.set(
      f.index,
      requestAnimationFrame(() => {
        this.#reflowRaf.delete(f.index);
        const m = this.#mounted.get(f.index);
        if (!m || m.frame !== f || !f.ready) return;
        if (this.remeasure(f.index)) this.#hooks.onReflow(f);
      }),
    );
  }

  #mount(i: number): Promise<SectionFrame | null> {
    const section = this.#book.sections[i]!;
    const frame = new SectionFrame(i, this.#frameHooks);
    const m: Mounted = { frame, ready: Promise.resolve(null), acquired: false, columns: 1, off: [] };
    this.#size(m);
    this.clip.append(frame.iframe);
    this.#mounted.set(i, m);
    const run = async (): Promise<SectionFrame | null> => {
      let url: string;
      try {
        url = await section.load();
      } catch (e) {
        console.warn(`[PaginatorRenderer] section ${i} failed to load`, e);
        return this.#fail(i, frame);
      }
      if (this.#mounted.get(i)?.frame !== frame) {
        section.unload();
        return null;
      }
      m.acquired = true;
      try {
        await frame.load(url, this.#g.frameW, this.#css, this.#style.css);
      } catch (e) {
        if (this.#mounted.get(i)?.frame !== frame) return null;
        console.warn(`[PaginatorRenderer] section ${i} failed to render`, e);
        return this.#fail(i, frame);
      }
      if (this.#mounted.get(i)?.frame !== frame || !frame.doc) return null;
      frame.applyCss(this.#css, this.#style.css); // style or viewport may have changed while loading
      this.#listen(m, frame.doc);
      frame.show();
      frame.iframe.style.visibility = 'hidden';
      this.#measure(m);
      this.#placeAll();
      this.#hooks.onSectionReady(frame);
      return frame;
    };
    m.ready = run();
    return m.ready;
  }

  /** Extra document listeners: content reflow (body size, late images), clicks, stray scrolling. */
  #listen(m: Mounted, doc: Document): void {
    const f = m.frame;
    const ro = new ResizeObserver(() => this.#scheduleReflow(f));
    if (doc.body) ro.observe(doc.body);
    m.off.push(() => ro.disconnect());
    const add = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, capture: boolean): void => {
      doc.addEventListener(type, fn as EventListener, { capture, passive: true });
      m.off.push(() => doc.removeEventListener(type, fn as EventListener, { capture }));
    };
    add('load', () => this.#scheduleReflow(f), true); // images and fonts inside the section
    add(
      'scroll',
      () => {
        // Selection autoscroll or find-in-page must not move the columns: the transform does.
        const se = doc.scrollingElement;
        if (se && (se.scrollLeft !== 0 || se.scrollTop !== 0)) {
          se.scrollLeft = 0;
          se.scrollTop = 0;
        }
      },
      true,
    );
    add(
      'click',
      (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
        const sel = doc.getSelection();
        if (sel && !sel.isCollapsed) return; // finishing a text selection is not a page turn
        const box = f.iframe.getBoundingClientRect();
        this.#hooks.onClick(box.left + e.clientX, e);
      },
      false,
    );
  }

  #fail(i: number, frame: SectionFrame): null {
    if (this.#mounted.get(i)?.frame === frame) {
      this.#failed.add(i);
      this.#unmount(i);
    }
    return null;
  }

  #unmount(i: number): void {
    const m = this.#mounted.get(i);
    if (!m) return;
    this.#mounted.delete(i);
    const raf = this.#reflowRaf.get(i);
    if (raf) cancelAnimationFrame(raf);
    this.#reflowRaf.delete(i);
    for (const off of m.off) off();
    m.frame.destroy();
    if (m.acquired) {
      try {
        this.#book.sections[i]?.unload();
      } catch (e) {
        console.warn(`[PaginatorRenderer] section ${i} unload failed`, e);
      }
    }
    if (this.#base === i) this.#base = -1;
  }

  destroy(): void {
    for (const i of [...this.#mounted.keys()]) this.#unmount(i);
    this.root.remove();
  }
}
