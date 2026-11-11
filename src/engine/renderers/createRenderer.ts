/**
 * Renderer factory (PRD §10.3 "Renderer choice", FR-LM-0; ADR-005).
 *   scroll + 1 (DEFAULT) → FlowRenderer
 *   paged + 1            → PaginatorRenderer, one page, animated page turns (ADR-004, ADR-005)
 *   scroll + 2, paged + 2 (opt-in) → PaginatorRenderer in two-page FILMSTRIP mode (owner decision
 *                          t20u, ADR-005): pages move horizontally, one page per step. Both flows
 *                          get the same renderer; reader.flow only decides whether left/right-third
 *                          clicks turn pages (paged) or not (scroll).
 * PageGridRenderer (ADR-002, vertical rows of two pages) is no longer chosen (superseded by
 * ADR-005); it stays in the tree until the filmstrip is signed off, so a revert is one line here.
 * The factory never picks two pages by itself: it only honours an explicit `pagesPerView: 2`.
 * Narrow-window fallback: below `minSpreadWidthPx` the filmstrip shows one page and returns to two
 * when wide again (event `spread`, getter getEffectivePagesPerView()); the saved preference is
 * never changed, and a one-page request never shows two.
 */
import { FlowRenderer, type FlowRendererOptions, type LocatorBridge } from './FlowRenderer';
import type { GridSupport } from './grid/gridSupport';
import { DEFAULT_MIN_SPREAD_WIDTH_PX } from './grid/gridMath';
import { PaginatorRenderer } from './PaginatorRenderer';
import type { Renderer } from './Renderer';

export interface ReaderLayout {
  /** reader.flow. Default 'scroll'. */
  flow?: 'scroll' | 'paged';
  /** reader.pagesPerView. Default 1. */
  pagesPerView?: 1 | 2;
}

/** What ReaderView, the smoothScroller and the key router use; every renderer implements it. */
export interface ScrollRenderer extends Renderer {
  /**
   * True for PaginatorRenderer (paged + 1, two-page filmstrip): page.next/prev are routed through
   * the smoothScroller like scroll.down/up, so a held page key moves the filmstrip continuously
   * (paged + 1: still one page per press, via holdStart). Absent = page(±1) per press (flow).
   */
  readonly turnsPages?: boolean;
  readonly scrollElement: HTMLElement | null;
  readonly sectionCount: number;
  getScrollTop(): number;
  setScrollTop(px: number): void;
  getMaxScroll(): number;
  getViewportHeight(): number;
  isAtEnd(): boolean;
  getLineHeight(): number;
  getSectionIndex(): number;
  setPageOverlapLines(n: number): void;
  goToSectionEdge(index: number, edge: 'start' | 'end'): Promise<void>;
  cancelScrollAnimation(): void;
  /** Pages actually shown (1 below layout.minSpreadWidthPx even when 2 is saved). */
  getEffectivePagesPerView(): 1 | 2;
  /** layout.minSpreadWidthPx changed at runtime (relayout, locator preserved). */
  setMinSpreadWidth(px: number): void;
}

export type RendererKind = 'flow' | 'paged' | 'filmstrip';
/** Kept for ReaderView's notice; since ADR-005 no layout falls back (never set). */
export type RendererFallback = 'grid-unsupported';

export interface CreateRendererOptions {
  locatorBridge?: LocatorBridge;
  keyTarget?: EventTarget;
  onExternalLink?: (href: string) => void;
  /** scroll.pageOverlapLines (flow only; the grid pages by whole rows). */
  pageOverlapLines?: number;
  /** layout.pageGap, until CompiledStyle carries `pageGapPx`. */
  pageGapPx?: number;
  /** layout.minSpreadWidthPx (default 1000): two-page layouts show one page below this width. */
  minSpreadWidthPx?: number;
  /** Extra FlowRenderer options (spike switches). */
  flow?: Omit<FlowRendererOptions, 'locatorBridge' | 'keyTarget' | 'onExternalLink' | 'pageOverlapLines'>;
  /** Ignored since ADR-005 (the filmstrip needs no wrapped multicol); kept for option parity. */
  detectSupport?: () => GridSupport;
}

export interface CreatedRenderer {
  renderer: ScrollRenderer;
  kind: RendererKind;
  /** Why the requested layout could not be honoured (null = it was). Show a notice, keep the setting. */
  fallback: RendererFallback | null;
  /** Always null since ADR-005 (kept for the logs / dev overlay shape). */
  support: GridSupport | null;
}

/** Pure decision, unit-tested: which renderer a layout gets. */
export function chooseRenderer(layout: ReaderLayout): { kind: RendererKind; fallback: RendererFallback | null; support: GridSupport | null } {
  const flow = layout.flow ?? 'scroll';
  const pages = layout.pagesPerView === 2 ? 2 : 1;
  const kind: RendererKind = pages === 2 ? 'filmstrip' : flow === 'paged' ? 'paged' : 'flow';
  return { kind, fallback: null, support: null };
}

export function createRenderer(layout: ReaderLayout, o: CreateRendererOptions = {}): CreatedRenderer {
  const choice = chooseRenderer(layout);
  const common = { locatorBridge: o.locatorBridge, keyTarget: o.keyTarget, onExternalLink: o.onExternalLink };
  const minSpreadWidthPx = o.minSpreadWidthPx ?? DEFAULT_MIN_SPREAD_WIDTH_PX;
  const renderer: ScrollRenderer =
    choice.kind === 'flow'
      ? new FlowRenderer(defined({ ...o.flow, ...common, pageOverlapLines: o.pageOverlapLines }))
      : new PaginatorRenderer(
          defined({
            ...common,
            pageGapPx: o.pageGapPx,
            minSpreadWidthPx,
            pagesPerView: choice.kind === 'filmstrip' ? (2 as const) : (1 as const),
            clickZones: (layout.flow ?? 'scroll') === 'paged',
          }),
        );
  return { renderer, ...choice };
}

/** Drop undefined keys so they cannot overwrite the renderers' defaults (`{ ...defaults, ...opts }`). */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
