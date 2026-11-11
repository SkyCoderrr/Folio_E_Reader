/**
 * The page strip (ADR-005): every mounted, measured section laid end to end as one horizontal row
 * of columns (pages). Positions are in COLUMNS relative to the first column of a base section, so
 * nothing depends on unmounted sections. The view shows `cols` (1 or 2) consecutive columns; its
 * left page is the reading position. A chapter's last page and the next chapter's first page can
 * sit side by side (owner decision t20u, ADR-005), so every step is exactly one page.
 */

export interface StripBlock {
  /** Contiguous ready sections around the base: [first, last]. */
  first: number;
  last: number;
  /** Start column of each section in the block, relative to the base section's first column. */
  starts: Map<number, number>;
  /** One past the last column of `last`. */
  end: number;
}

/** Contiguous run of ready sections containing `base` (which must be ready). */
export function stripBlock(base: number, ready: (i: number) => boolean, columns: (i: number) => number, count: number): StripBlock {
  const starts = new Map<number, number>([[base, 0]]);
  let first = base;
  let start = 0;
  while (first - 1 >= 0 && ready(first - 1)) {
    first--;
    start -= Math.max(1, columns(first));
    starts.set(first, start);
  }
  let last = base;
  let end = Math.max(1, columns(base));
  while (last + 1 < count && ready(last + 1)) {
    last++;
    starts.set(last, end);
    end += Math.max(1, columns(last));
  }
  return { first, last, starts, end };
}

export interface StripBounds {
  /** Smallest / largest left-page column the view may rest on (base-relative). */
  min: number;
  max: number;
  /** The bounds are the book's own edges (not just the edge of what is loaded). */
  atBookStart: boolean;
  atBookEnd: boolean;
}

/**
 * Where the left page may go. At the book end the last page sits in the RIGHT slot of a two-page
 * view (no blank page after the book). At the edge of the loaded block the left page may be the
 * last loaded page (the right slot fills in once the next section is ready).
 */
export function stripBounds(b: StripBlock, count: number, cols: 1 | 2): StripBounds {
  const min = b.starts.get(b.first) ?? 0;
  const atBookStart = b.first === 0;
  const atBookEnd = b.last >= count - 1;
  const max = atBookEnd ? Math.max(min, b.end - cols) : b.end - 1;
  return { min, max, atBookStart, atBookEnd };
}

/** Section and in-section column of a base-relative column (clamped into the block). */
export function locateColumn(b: StripBlock, column: number): { index: number; column: number } {
  let index = b.first;
  for (let i = b.first; i <= b.last; i++) {
    if ((b.starts.get(i) ?? 0) <= column) index = i;
  }
  const start = b.starts.get(index) ?? 0;
  const next = index < b.last ? (b.starts.get(index + 1) ?? b.end) : b.end;
  return { index, column: Math.max(0, Math.min(next - start - 1, column - start)) };
}

/** Sections a view resting at `column` shows (left page's section, and the right page's). */
export function visibleSections(b: StripBlock, column: number, cols: 1 | 2): number[] {
  const left = locateColumn(b, column).index;
  if (cols === 1) return [left];
  const right = locateColumn(b, column + 1).index;
  return right === left ? [left] : [left, right];
}
