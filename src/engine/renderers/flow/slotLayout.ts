/**
 * Pure vertical layout model of the flow track: [padTop][slot 0][slot 1]…[slot n-1][padBottom].
 * Slot i = separator (i > 0) + section content. All heights are integer CSS px so the model
 * matches the DOM exactly (the DOM slots get these heights as explicit `height: Npx`).
 */

export interface SlotGeometry {
  /** Space above slot 0 (style marginY). */
  padTop: number;
  /** Space below the last slot. */
  padBottom: number;
  /** Chapter separator height, drawn at the top of every slot except slot 0. */
  separatorPx: number;
}

export class SlotLayout {
  readonly count: number;
  #content: Float64Array;
  #measured: Uint8Array;
  /** #rel[i] = Σ slotHeight(j) for j < i (relative to padTop). Length count + 1. */
  #rel: Float64Array;
  #dirtyFrom = 0;
  #geo: SlotGeometry;

  constructor(count: number, geometry: SlotGeometry, initialContentPx = 0) {
    this.count = Math.max(0, Math.floor(count));
    this.#content = new Float64Array(this.count).fill(Math.max(0, Math.round(initialContentPx)));
    this.#measured = new Uint8Array(this.count);
    this.#rel = new Float64Array(this.count + 1);
    this.#geo = { ...geometry };
  }

  get geometry(): Readonly<SlotGeometry> {
    return this.#geo;
  }

  setGeometry(geometry: SlotGeometry): void {
    this.#geo = {
      padTop: Math.round(geometry.padTop),
      padBottom: Math.round(geometry.padBottom),
      separatorPx: Math.round(geometry.separatorPx),
    };
    this.#dirtyFrom = 0;
  }

  separatorOf(i: number): number {
    return i > 0 ? this.#geo.separatorPx : 0;
  }

  contentHeight(i: number): number {
    return this.#content[i] ?? 0;
  }

  isMeasured(i: number): boolean {
    return this.#measured[i] === 1;
  }

  slotHeight(i: number): number {
    return this.separatorOf(i) + this.contentHeight(i);
  }

  /** Returns true when the stored height changed. */
  setContentHeight(i: number, px: number, measured: boolean): boolean {
    if (i < 0 || i >= this.count) return false;
    const h = Math.max(0, Math.round(px));
    this.#measured[i] = measured ? 1 : 0;
    if (this.#content[i] === h) return false;
    this.#content[i] = h;
    // -1 = prefix sums clean; otherwise the first #rel entry that must be recomputed.
    this.#dirtyFrom = this.#dirtyFrom < 0 ? i + 1 : Math.min(this.#dirtyFrom, i + 1);
    return true;
  }

  #ensure(): void {
    if (this.#dirtyFrom < 0) return;
    const rel = this.#rel;
    let k = Math.max(1, this.#dirtyFrom);
    if (this.#dirtyFrom === 0) rel[0] = 0;
    for (; k <= this.count; k++) rel[k] = rel[k - 1]! + this.slotHeight(k - 1);
    this.#dirtyFrom = -1;
  }

  /** Top of slot i (where its separator starts), in track coordinates (= scrollTop space). */
  slotTop(i: number): number {
    this.#ensure();
    const k = Math.min(Math.max(0, i), this.count);
    return this.#geo.padTop + this.#rel[k]!;
  }

  /** Top of section i's document (below its separator). */
  contentTop(i: number): number {
    return this.slotTop(i) + this.separatorOf(i);
  }

  get totalHeight(): number {
    this.#ensure();
    return this.#geo.padTop + this.#rel[this.count]! + this.#geo.padBottom;
  }

  /**
   * Index of the slot containing track position y. Positions in padTop map to 0 and positions
   * in padBottom (or beyond) map to the last slot. -1 for an empty book.
   */
  indexAt(y: number): number {
    if (this.count === 0) return -1;
    this.#ensure();
    const rel = y - this.#geo.padTop;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#rel[mid]! <= rel) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
