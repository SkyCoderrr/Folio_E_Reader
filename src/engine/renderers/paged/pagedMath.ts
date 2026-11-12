/**
 * Pure geometry and paging logic for PaginatorRenderer (PRD FR-LM-3, §10.4 step 6; ADR-004, ADR-005).
 *
 * Each section is ONE iframe whose root is a horizontal multicol container of fixed height:
 *   width = frameW (one page: textW; two pages: 2·textW + colGap) · height = textH
 *   column-count = cols · column-width = textW · column-gap = colGap · column-fill: auto
 * so the browser paginates the section into columns of exactly textW × textH; overflow columns
 * continue to the right with a constant pitch (textW + colGap). Column c spans document
 * x ∈ [c·pitch, c·pitch + textW]. A page is one column.
 *
 * ADR-005: the iframes of the mounted sections sit end to end as one strip of columns (see
 * stripMath.ts) and the view shows `cols` consecutive columns. A page turn moves the strip by one
 * pitch with a short transform-only ease-out; two pages per view advance ONE page per step.
 */
import { MIN_COLUMN_PX } from '../flow/flowMath';

/** Two pages (or one) side by side across the viewport: the spread the filmstrip shows. */
export interface SpreadInput {
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

export interface SpreadGeometry {
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

export function spreadGeometry(i: SpreadInput): SpreadGeometry {
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


export interface PagedInput {
  viewportW: number;
  viewportH: number;
  gapPx: number;
  marginXPx: number;
  marginYPx: number;
  maxLineWidthPx: number | null;
  /** Effective pages per view (after the narrow-window fallback). */
  cols: 1 | 2;
  /** Reading line height in px. Given: the text box is a whole number of lines, centred (t24u). */
  lineHeightPx?: number;
}

export interface PagedGeometry extends SpreadGeometry {
  /** Distance between the left edges of consecutive columns. */
  pitch: number;
  /** Glyph overhang kept visible on each side of the text area (italic, hanging punctuation). */
  overhang: number;
  /** Clip box in the host: [clipLeft, clipLeft + clipW] × [marginY, marginY + textH]. */
  clipLeft: number;
  clipW: number;
}

/** Most overhang shown outside the text column (px). */
export const MAX_OVERHANG_PX = 32;

export function pagedGeometry(i: PagedInput): PagedGeometry {
  const g = spreadGeometry({ ...i, cols: i.cols });
  const overhang = Math.min(g.pageInset, MAX_OVERHANG_PX);
  // One page: only one column is ever visible, so the gap only has to keep the neighbours'
  // overhang out of the clip box. Two pages: the gap is fixed by the spread layout.
  const colGap = g.cols === 1 ? 2 * overhang : g.colGap;
  // Whole lines only fit a page, so a text height that is not a multiple of the line height leaves
  // a strip below the last line (up to one line: an "empty bar at the bottom" on tall windows).
  // Trim the box to whole lines and give the remainder half to each margin: top and bottom match.
  const { marginY, textH } = wholeLines(g.marginY, g.textH, i.lineHeightPx);
  const frameW = g.cols * g.textW + (g.cols - 1) * colGap;
  return {
    ...g,
    marginY,
    textH,
    colGap,
    frameW,
    pitch: g.textW + colGap,
    overhang,
    clipLeft: g.frameLeft - overhang,
    clipW: frameW + 2 * overhang,
  };
}

/** Trim `textH` to a whole number of lines; the leftover px move into the vertical margin (halved). */
export function wholeLines(marginY: number, textH: number, lineHeightPx: number | undefined): { marginY: number; textH: number } {
  const lh = lineHeightPx ?? 0;
  if (!(lh >= 8) || !(textH >= 2 * lh)) return { marginY, textH };
  const lines = Math.floor((textH + 1e-6) / lh);
  const fitted = Math.min(textH, Math.ceil(lines * lh - 1e-6));
  const spare = textH - fitted;
  return { marginY: marginY + Math.floor(spare / 2), textH: fitted };
}

/** Column index of a document x (left edge + 1 px of a rect). */
export function columnOfX(x: number, pitch: number): number {
  return pitch > 0 ? Math.max(0, Math.floor(x / pitch)) : 0;
}

/** Columns a section occupies, from the right edge (document x) of its content. ≥ 1. */
export function columnsForRight(right: number, pitch: number): number {
  if (!(pitch > 0) || !(right > 1)) return 1;
  return Math.max(1, Math.floor((right - 1) / pitch) + 1);
}

/** Reading-order key in a paged document: column, then y within the column. Monotonic. */
export function pagedKey(x: number, y: number, g: Pick<PagedGeometry, 'pitch' | 'textH'>): number {
  return columnOfX(x, g.pitch) * Math.max(1, g.textH) + Math.max(0, y);
}

/**
 * Iframe width holding every column of a section: exactly its strip length, so it ends where the
 * next section's iframe starts and never covers it (the multicol root keeps its own CSS width).
 */
export function stripFrameWidth(columns: number, g: Pick<PagedGeometry, 'pitch'>): number {
  return Math.max(1, columns) * g.pitch;
}

/** One page step (ADR-005): ease-out duration, ms. */
export const STEP_MS = 180;

/** Click zones (LM-03): left third = previous, right third = next, middle = nothing. */
export function clickZone(x: number, left: number, width: number): -1 | 0 | 1 {
  if (!(width > 0)) return 0;
  const t = (x - left) / width;
  if (t < 1 / 3) return -1;
  if (t > 2 / 3) return 1;
  return 0;
}

/**
 * Wheel → page turns. Deltas accumulate until they pass a threshold, then one page turns and the
 * gesture is locked until the wheel has been quiet for `quietMs` (touchpad inertia, fast spins).
 * Line-mode deltas count as 16 px per line, page-mode as one threshold.
 */
export class WheelPager {
  #sum = 0;
  #lockedUntil = 0;
  #last = 0;
  constructor(
    readonly thresholdPx = 40,
    readonly quietMs = 160,
    readonly maxLockMs = 700,
  ) {}

  feed(deltaY: number, deltaMode: number, now: number): -1 | 0 | 1 {
    const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * this.thresholdPx : deltaY;
    const quiet = now - this.#last > this.quietMs;
    this.#last = now;
    if (this.#lockedUntil > 0) {
      if (!quiet && now < this.#lockedUntil) return 0;
      this.#lockedUntil = 0;
      this.#sum = 0;
    }
    if (quiet || Math.sign(px) !== Math.sign(this.#sum)) this.#sum = 0;
    this.#sum += px;
    if (Math.abs(this.#sum) < this.thresholdPx) return 0;
    const dir = this.#sum > 0 ? 1 : -1;
    this.#sum = 0;
    this.#lockedUntil = now + this.maxLockMs;
    return dir;
  }

  reset(): void {
    this.#sum = 0;
    this.#lockedUntil = 0;
  }
}
