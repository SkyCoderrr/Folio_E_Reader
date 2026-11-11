/**
 * Which sections are mounted (PRD §10.4 step 4, LM-01): the visible sections plus a radius of 1
 * (2 while scrolling fast), capped at `maxMounted` (5). The cap is strict, including navigation pins and tiny chapters.
 * Excess visible chapters keep their measured or estimated spacer heights (PRD 10.4).
 */

export interface WindowInput {
  firstVisible: number;
  lastVisible: number;
  count: number;
  /** 1 normally, 2 while scrolling fast. */
  radius: number;
  maxMounted: number;
  /** Scroll direction: the window keeps more sections ahead of it when trimming. */
  direction: -1 | 0 | 1;
}

export interface SlotWindow {
  first: number;
  /** Inclusive. first > last means empty. */
  last: number;
}

export function selectWindow(w: WindowInput): SlotWindow {
  if (w.count <= 0) return { first: 0, last: -1 };
  const fv = clampInt(Math.min(w.firstVisible, w.lastVisible), 0, w.count - 1);
  const lv = clampInt(Math.max(w.firstVisible, w.lastVisible), 0, w.count - 1);
  const r = Math.max(0, Math.floor(w.radius));
  let first = Math.max(0, fv - r);
  let last = Math.min(w.count - 1, lv + r);
  const cap = Math.max(1, Math.floor(w.maxMounted));
  // PRD 10.4: the first visible chapter owns the window; even tiny chapters obey
  // the budget. Excess visible chapters retain their measured/estimated spacers.
  if (lv - fv + 1 >= cap) return { first: fv, last: Math.min(w.count - 1, fv + cap - 1) };
  while (last - first + 1 > cap) {
    const above = fv - first;
    const below = last - lv;
    let trimTop: boolean;
    if (w.direction > 0) trimTop = above > 0;
    else if (w.direction < 0) trimTop = below === 0;
    else trimTop = above >= below;
    if (trimTop && above > 0) first++;
    else if (below > 0) last--;
    else first++;
  }
  return { first, last };
}

export interface MountPlan {
  mount: number[];
  unmount: number[];
}

/**
 * Diff the mounted set against the desired window. Mounted sections just outside the window
 * (distance 1) are kept while the total stays within `maxMounted` (hysteresis against
 * mount/unmount thrash at a boundary). Pinned sections reserve capacity within the same cap.
 * `mount` is ordered by distance from the window centre (visible sections load first).
 */
export function planMounts(
  mounted: Iterable<number>,
  win: SlotWindow,
  pinned: ReadonlySet<number>,
  maxMounted: number,
): MountPlan {
  const current = new Set(mounted);
  const cap = Math.max(1, Math.floor(maxMounted));
  const centre = (win.first + win.last) / 2;
  // Pins reserve capacity inside the same budget. Newest navigation wins.
  const desired = [...pinned].reverse().filter((i) => current.has(i));
  const window: number[] = [];
  for (let i = win.first; i <= win.last; i++) window.push(i);
  window.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
  desired.push(...window);
  desired.push(...[...current].filter((i) => i === win.first - 1 || i === win.last + 1));
  const keep = new Set([...new Set(desired)].slice(0, cap));
  return {
    mount: [...keep].filter((i) => !current.has(i)),
    unmount: [...current].filter((i) => !keep.has(i)).sort((a, b) => a - b),
  };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}
