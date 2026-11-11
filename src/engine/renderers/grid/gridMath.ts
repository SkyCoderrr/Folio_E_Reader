/**
 * Pure geometry for PageGridRenderer (PRD FR-LM-2, §8.2 owner decision; ADR-002).
 *
 * A row holds two pages side by side. Every page is exactly one viewport tall, so the row pitch is
 * the viewport height and PgDn moves exactly one row. Pages share the viewport width:
 * pageW = floor((viewportW − gap) / 2). Inside each page the text column is
 * min(pageW − 2·marginX, maxLineWidth), centred, with marginY above and below.
 *
 * A section is ONE iframe whose root is a wrapped multicol container (candidate A):
 *   column-count 2 · column-height = textH · column-wrap: wrap · column-gap = colGap · row-gap = 2·marginY
 *   padding-block = marginY
 * so row r of the section's document spans [r·rowH, (r+1)·rowH) and its text area is
 * [r·rowH + marginY, (r+1)·rowH − marginY]. The iframe covers both text columns and the gutter
 * between them: x ∈ [0, textW] is the left page's text, x ∈ [textW + colGap, frameW] the right one.
 */
import { MIN_COLUMN_PX } from '../flow/flowMath';

export interface GridInput {
  viewportW: number;
  viewportH: number;
  /** layout.pageGap: desk gutter between the two pages. */
  gapPx: number;
  marginXPx: number;
  marginYPx: number;
  /** null = fill the page. */
  maxLineWidthPx: number | null;
  /**
   * Pages per row: 2 (default), or 1 for the narrow-window fallback (viewport narrower than
   * layout.minSpreadWidthPx): one page as wide as the viewport per row.
   */
  cols?: 1 | 2;
}

export interface GridGeometry {
  /** Pages (text columns) per row: 2, or 1 in the narrow-window fallback. */
  cols: 1 | 2;
  /** Row pitch = page height = viewport height (integer px). */
  rowH: number;
  /** Fixed page height; row pitch additionally includes the desk gap. */
  pageH: number;
  pageW: number;
  gapPx: number;
  /** x of the left page's left edge in the scroller (centres the spread when W − gap is odd). */
  spreadLeft: number;
  /** Text column width inside each page (= multicol column width). */
  textW: number;
  /** Horizontal inset of the text column inside its page. */
  pageInset: number;
  /** Space between the two text columns = right inset + gap + left inset. */
  colGap: number;
  /** Vertical page margin, clamped so at least one line's worth of text height remains. */
  marginY: number;
  /** Text height of one page (= multicol column-height). */
  textH: number;
  /** Section iframe: x in the scroller, and width (both text columns plus the gutter). */
  frameLeft: number;
  frameW: number;
}

/** Smallest text height we lay out; below this the vertical margins shrink. */
export const MIN_TEXT_H = 48;

export function gridGeometry(i: GridInput): GridGeometry {
  const W = Math.max(0, Math.floor(i.viewportW));
  const pageH = Math.max(1, Math.floor(i.viewportH));
  const cols = i.cols === 1 ? 1 : 2;
  const gapPx = Math.max(0, Math.round(i.gapPx));
  const rowH = pageH + gapPx;
  const pageW = cols === 2 ? Math.max(1, Math.floor((W - gapPx) / 2)) : Math.max(1, W);
  const spreadW = cols === 2 ? 2 * pageW + gapPx : pageW;
  const spreadLeft = Math.max(0, Math.floor((W - spreadW) / 2));
  const avail = Math.max(0, pageW - 2 * Math.max(0, i.marginXPx));
  const capped = i.maxLineWidthPx && i.maxLineWidthPx > 0 ? Math.min(avail, i.maxLineWidthPx) : avail;
  const textW = Math.floor(Math.min(pageW, Math.max(Math.min(pageW, MIN_COLUMN_PX), capped)));
  const pageInset = Math.floor((pageW - textW) / 2);
  const colGap = cols === 2 ? pageW - textW + gapPx : 0;
  const maxMarginY = Math.max(0, Math.floor((pageH - Math.min(pageH, MIN_TEXT_H)) / 2));
  const marginY = Math.min(Math.max(0, Math.round(i.marginYPx)), maxMarginY);
  const textH = pageH - 2 * marginY;
  return {
    cols,
    rowH,
    pageH,
    pageW,
    gapPx,
    spreadLeft,
    textW,
    pageInset,
    colGap,
    marginY,
    textH,
    frameLeft: spreadLeft + pageInset,
    frameW: cols * textW + (cols - 1) * colGap,
  };
}

/** Rows a section occupies, from its measured document height (1 px rounding tolerance). */
export function rowsForHeight(px: number, rowH: number): number {
  if (!(rowH > 0)) return 1;
  return Math.max(1, Math.ceil((Math.max(0, px) - 1) / rowH));
}

/** Snap an estimated content height up to whole rows (never less than one row). */
export function snapToRows(px: number, rowH: number): number {
  return rowsForHeight(px + 1, rowH) * rowH;
}

/** Row index of a y inside a section document. */
export function rowOf(docY: number, rowH: number): number {
  return rowH > 0 ? Math.max(0, Math.floor(docY / rowH)) : 0;
}

/** Track y of the top of the row containing track y `y` in a section starting at `contentTop`. */
export function rowAlign(y: number, contentTop: number, rowH: number): number {
  return contentTop + rowOf(y - contentTop, rowH) * rowH;
}

/** PgDn/PgUp in grid mode: exactly one row, no overlap lines (owner decision 2026-11-09). */
export function gridPageStep(g: Pick<GridGeometry, 'rowH'>): number {
  return g.rowH;
}

/**
 * Home/End target: the first row of a section, or its last row (so the final spread is fully in
 * view; content height is a whole number of rows).
 */
export function sectionEdgeY(contentTop: number, contentHeight: number, rowH: number, edge: 'start' | 'end'): number {
  return edge === 'start' ? contentTop : contentTop + Math.max(0, contentHeight - rowH);
}

type PageGeometry = Pick<GridGeometry, 'rowH' | 'frameW'> & { cols?: 1 | 2 };

/** Page index inside a section of a point in its document: cols·row + (0 left, 1 right). */
export function pageAt(x: number, y: number, g: PageGeometry): number {
  const cols = g.cols ?? 2;
  return cols * rowOf(y, g.rowH) + (cols === 2 && x >= g.frameW / 2 ? 1 : 0);
}

/**
 * Reading-order key of a point: pages in order, then y within the page. Monotonic in document
 * order (unlike raw y, which restarts at the top of the right page), so it can be bisected.
 */
export function readingKey(x: number, y: number, g: PageGeometry): number {
  const row = rowOf(y, g.rowH);
  return pageAt(x, y, g) * g.rowH + (y - row * g.rowH);
}

/**
 * Where the first visible line of a section starts, given the viewport top `localY` in section
 * document coordinates: the topmost visible row's left page, at the viewport top (or the top of its
 * text area). If the row's text area is scrolled out except for less than half a line, the next row.
 */
export function firstVisibleProbe(localY: number, g: GridGeometry, lineH: number): { row: number; y: number } {
  let row = rowOf(localY, g.rowH);
  let d = Math.max(0, localY) - row * g.rowH;
  if (d > g.pageH - g.marginY - 0.5 * lineH) {
    row += 1;
    d = 0;
  }
  return { row, y: row * g.rowH + Math.max(d, g.marginY) };
}

/**
 * Px-per-unit prior in grid track px, from the single-column prior: the same text needs
 * flowPx / (cols · textH) rows of rowH each.
 */
export function gridPxPerUnit(
  flowPxPerUnit: number,
  g: Pick<GridGeometry, 'rowH' | 'textH'> & { cols?: 1 | 2 },
): number {
  return (flowPxPerUnit * g.rowH) / ((g.cols ?? 2) * Math.max(1, g.textH));
}

/**
 * Narrow-window fallback (FR-LM-3, LM-04, LM-07): a requested two-page layout shows one page while
 * the reader viewport is narrower than layout.minSpreadWidthPx, and two again once it is wide
 * enough. Never returns 2 for a one-page request (two pages is opt-in only, FR-LM-0).
 */
export function effectivePages(requested: 1 | 2, viewportW: number, minSpreadWidthPx: number): 1 | 2 {
  if (requested !== 2) return 1;
  return viewportW >= Math.max(0, minSpreadWidthPx) ? 2 : 1;
}

/** settings layout.minSpreadWidthPx default (PRD §8.2). */
export const DEFAULT_MIN_SPREAD_WIDTH_PX = 1000;
