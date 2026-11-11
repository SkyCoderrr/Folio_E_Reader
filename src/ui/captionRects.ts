import type { CaptionRects, Rect } from '@contract/types';

const round = (n: number) => Math.round(n * 100) / 100;

function toRect(r: { x: number; y: number; width: number; height: number }): Rect {
  return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Contract validity: finite, width/height > 0, no overlap, inside the viewport. */
export function captionRectsValid(r: CaptionRects, vw: number, vh: number): boolean {
  const all = [r.minimize, r.maximize, r.close];
  for (const q of all) {
    if (![q.x, q.y, q.width, q.height].every(Number.isFinite)) return false;
    if (q.width <= 0 || q.height <= 0) return false;
    if (q.x < 0 || q.y < 0 || q.x + q.width > vw + 0.01 || q.y + q.height > vh + 0.01) return false;
  }
  return !(
    overlaps(r.minimize, r.maximize) ||
    overlaps(r.maximize, r.close) ||
    overlaps(r.minimize, r.close)
  );
}

type Boxed = { getBoundingClientRect(): { x: number; y: number; width: number; height: number } };

/**
 * Measure the three buttons in unzoomed viewport CSS px. Returns null when an element is
 * missing or the geometry would be rejected by the contract (so the caller sends null).
 */
export function measureCaptionRects(
  els: { minimize: Boxed | null; maximize: Boxed | null; close: Boxed | null },
  vw: number,
  vh: number,
): CaptionRects | null {
  if (!els.minimize || !els.maximize || !els.close) return null;
  const rects: CaptionRects = {
    minimize: toRect(els.minimize.getBoundingClientRect()),
    maximize: toRect(els.maximize.getBoundingClientRect()),
    close: toRect(els.close.getBoundingClientRect()),
  };
  return captionRectsValid(rects, vw, vh) ? rects : null;
}

/**
 * Serialises async sends: one in flight, and while it runs only the latest pushed value is
 * kept. A failed send never stalls the queue. Values are never de-duplicated (calls are
 * idempotent and Rust may have invalidated the overlay on its own).
 */
export function createLatestSender<T>(send: (value: T) => Promise<unknown>) {
  let inFlight = false;
  let pending: { value: T } | undefined;
  async function drain(first: T): Promise<void> {
    inFlight = true;
    let next: { value: T } | undefined = { value: first };
    while (next) {
      pending = undefined;
      try {
        await send(next.value);
      } catch {
        /* the sender reports its own errors */
      }
      next = pending;
    }
    inFlight = false;
  }
  return {
    push(value: T): void {
      if (inFlight) pending = { value };
      else void drain(value);
    },
  };
}
