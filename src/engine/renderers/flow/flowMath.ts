/** Pure math for FlowRenderer: page step, column width, anchoring, progress, velocity. */

/** Narrowest column the renderer will produce, even when margins exceed the window. */
export const MIN_COLUMN_PX = 160;

/**
 * PgDn/PgUp distance in scroll flow (LM-06): viewport − overlapLines × lineHeight, so the lines
 * that were at the bottom end up at the top. Never less than one line; integer px.
 */
export function pageStep(viewportPx: number, lineHeightPx: number, overlapLines: number): number {
  const lh = Math.max(1, lineHeightPx);
  const step = viewportPx - Math.max(0, Math.floor(overlapLines)) * lh;
  return Math.max(Math.round(lh), Math.round(step));
}

/** Width of the single text column (= section iframe width), centred in the scroller. */
export function columnWidth(containerPx: number, marginXPx: number, maxLineWidthPx: number | null): number {
  const avail = Math.max(0, containerPx - 2 * Math.max(0, marginXPx));
  const w = maxLineWidthPx && maxLineWidthPx > 0 ? Math.min(avail, maxLineWidthPx) : avail;
  return Math.floor(Math.max(Math.min(containerPx, MIN_COLUMN_PX), w));
}

/** Chapter separator height: a calm gap with a centred rule, at least 48 px or 3 lines. */
export function separatorHeight(lineHeightPx: number): number {
  return Math.round(Math.max(48, 3 * lineHeightPx));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Scroll anchoring (PRD §10.4 step 4, LM-01). The anchor is a point inside slot `a`:
 * `contentTop(a) + innerY`, shown at viewport offset `contentTop + innerY − scrollTop`.
 * After a layout change (slots above resized, or content inside `a` reflowed) the anchor must
 * stay at the same viewport offset. `scrollTopAfter` is read back from the DOM AFTER the change,
 * so any adjustment native CSS scroll anchoring already made is included; the return value is the
 * residual correction to add to scrollTop (0 when native anchoring already did the job).
 */
export interface AnchorState {
  contentTop: number;
  innerY: number;
  scrollTop: number;
}

export function anchorCorrection(before: AnchorState, after: AnchorState): number {
  const yBefore = before.contentTop + before.innerY - before.scrollTop;
  const yAfter = after.contentTop + after.innerY - after.scrollTop;
  const d = yAfter - yBefore;
  return Math.abs(d) < 0.5 ? 0 : d;
}

/** 0..1 over the book, weighting sections by Section.size (PRD §9.4 `progress`). */
export function bookProgress(sizes: ArrayLike<number>, index: number, fractionInSection: number): number {
  let total = 0;
  let before = 0;
  for (let i = 0; i < sizes.length; i++) {
    const s = Math.max(0, sizes[i] ?? 0);
    if (i < index) before += s;
    total += s;
  }
  if (!(total > 0)) return sizes.length > 0 ? clamp(index / sizes.length, 0, 1) : 0;
  const own = Math.max(0, sizes[index] ?? 0);
  return clamp((before + own * clamp(fractionInSection, 0, 1)) / total, 0, 1);
}

/** Inverse of bookProgress: which section and how far into it. */
export function locateProgress(sizes: ArrayLike<number>, progress: number): { index: number; fraction: number } {
  const n = sizes.length;
  if (n === 0) return { index: -1, fraction: 0 };
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(0, sizes[i] ?? 0);
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  if (!(total > 0)) {
    const index = Math.min(n - 1, Math.floor(p * n));
    return { index, fraction: 0 };
  }
  const target = p * total;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, sizes[i] ?? 0);
    if (s > 0 && target < acc + s) return { index: i, fraction: (target - acc) / s };
    acc += s;
  }
  let last = n - 1;
  while (last > 0 && !((sizes[last] ?? 0) > 0)) last--;
  return { index: last, fraction: 1 };
}

/** Smoothed scroll velocity (px/s) from scroll positions, used to widen the mount window. */
export class ScrollVelocity {
  #y = NaN;
  #t = NaN;
  #v = 0;
  readonly #alpha: number;
  /** alpha: smoothing factor per sample (0..1, higher = more reactive). */
  constructor(alpha = 0.4) {
    this.#alpha = alpha;
  }

  sample(y: number, tMs: number): number {
    if (Number.isFinite(this.#t) && tMs > this.#t) {
      const dt = (tMs - this.#t) / 1000;
      const inst = (y - this.#y) / dt;
      // A long gap means the previous motion ended; do not average across it.
      this.#v = dt > 0.25 ? inst : this.#v + this.#alpha * (inst - this.#v);
    }
    this.#y = y;
    this.#t = tMs;
    return this.#v;
  }

  get pxPerSec(): number {
    return this.#v;
  }

  reset(): void {
    this.#y = NaN;
    this.#t = NaN;
    this.#v = 0;
  }
}
