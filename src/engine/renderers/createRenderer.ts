/**
 * Renderer factory (PRD §10.3 "Renderer choice", FR-LM-0; ADR-005).
 *   scroll + 1 (DEFAULT) → FlowRenderer
 *   paged + 1            → PaginatorRenderer, one page, animated page turns (ADR-004, ADR-005)
 *   scroll + 2, paged + 2 (opt-in) → PaginatorRenderer in two-page FILMSTRIP mode (owner decision
 *                          t20u, ADR-005): pages move horizontally, one page per step. Both flows
 *                          get the same renderer; reader.flow only decides whether left/right-third
 *                          clicks turn pages (paged) or not (scroll).
 * The factory never picks two pages by itself: it only honours an explicit `pagesPerView: 2`.
 * Narrow-window fallback: below `minSpreadWidthPx` the filmstrip shows one page and returns to two
 * when wide again (event `spread`, getter getEffectivePagesPerView()); the saved preference is
 * never changed, and a one-page request never shows two.
 */
import { FlowRenderer, type FlowRendererOptions, type LocatorBridge } from './FlowRenderer';
import { DEFAULT_MIN_SPREAD_WIDTH_PX } from './paged/pagedMath';
import { PaginatorRenderer } from './PaginatorRenderer';
import type { Renderer } from './Renderer';
import type { ContinuousTarget, PagedTarget } from '../input/smoothScroller';

export interface ReaderLayout {
  /** reader.flow. Default 'scroll'. */
  flow?: 'scroll' | 'paged';
  /** reader.pagesPerView. Default 1. */
  pagesPerView?: 1 | 2;
}

/** What the reader session, the smoothScroller and the key router use from every renderer. */
interface ReaderRenderer extends Renderer {
  readonly scrollElement: HTMLElement | null;
  readonly sectionCount: number;
  getViewportHeight(): number;
  isAtEnd(): boolean;
  getLineHeight(): number;
  getSectionIndex(): number;
  goToSectionEdge(index: number, edge: 'start' | 'end'): Promise<void>;
  /** Pages actually shown (1 below layout.minSpreadWidthPx even when 2 is saved). */
  getEffectivePagesPerView(): 1 | 2;
  /** layout.minSpreadWidthPx changed at runtime (relayout, locator preserved). */
  setMinSpreadWidth(px: number): void;
}

/** FlowRenderer: scrolled by pixels; page(±1) is an animated viewport step. */
export interface ContinuousRenderer extends ReaderRenderer, ContinuousTarget {
  setScrollTop(px: number): void;
  setPageOverlapLines(n: number): void;
  cancelScrollAnimation(): void;
}

/** PaginatorRenderer (paged + 1, two-page filmstrip): page keys are held like arrows (ADR-005). */
export type PagedRenderer = ReaderRenderer & PagedTarget;

export type ScrollRenderer = ContinuousRenderer | PagedRenderer;

export type RendererKind = 'flow' | 'paged' | 'filmstrip';

export interface CreateRendererOptions {
  locatorBridge?: LocatorBridge;
  keyTarget?: EventTarget;
  onExternalLink?: (href: string) => void;
  /** scroll.pageOverlapLines (flow only; the paginator moves whole pages). */
  pageOverlapLines?: number;
  /** layout.minSpreadWidthPx (default 1000): two-page layouts show one page below this width. */
  minSpreadWidthPx?: number;
  /** Extra FlowRenderer options (spike switches). */
  flow?: Omit<FlowRendererOptions, 'locatorBridge' | 'keyTarget' | 'onExternalLink' | 'pageOverlapLines'>;
}

export interface CreatedRenderer {
  renderer: ScrollRenderer;
  kind: RendererKind;
}

/** Pure decision, unit-tested: which renderer a layout gets. */
export function chooseRenderer(layout: ReaderLayout): RendererKind {
  if (layout.pagesPerView === 2) return 'filmstrip';
  return (layout.flow ?? 'scroll') === 'paged' ? 'paged' : 'flow';
}

export function createRenderer(layout: ReaderLayout, o: CreateRendererOptions = {}): CreatedRenderer {
  const kind = chooseRenderer(layout);
  const common = { locatorBridge: o.locatorBridge, keyTarget: o.keyTarget, onExternalLink: o.onExternalLink };
  const minSpreadWidthPx = o.minSpreadWidthPx ?? DEFAULT_MIN_SPREAD_WIDTH_PX;
  const renderer: ScrollRenderer =
    kind === 'flow'
      ? new FlowRenderer(defined({ ...o.flow, ...common, pageOverlapLines: o.pageOverlapLines }))
      : new PaginatorRenderer(
          defined({
            ...common,
            minSpreadWidthPx,
            pagesPerView: kind === 'filmstrip' ? (2 as const) : (1 as const),
            clickZones: (layout.flow ?? 'scroll') === 'paged',
          }),
        );
  return { renderer, kind };
}

/** Drop undefined keys so they cannot overwrite the renderers' defaults (`{ ...defaults, ...opts }`). */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
