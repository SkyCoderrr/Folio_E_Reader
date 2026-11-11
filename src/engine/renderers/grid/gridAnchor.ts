/**
 * Reading position in two-page scroll (ADR-002). The locator is the first visible character in
 * reading order: the topmost visible row's LEFT page, at the first line in view (PRD §9.4 applied
 * to the top-left visible page). Positions are restored ROW-ALIGNED: the row containing the target
 * character is put at the viewport top, so a whole spread is visible.
 *
 * flow/sectionText's bisection cannot be reused as is: in a wrapped multicol document `y` restarts
 * at the top of the right page, so it is not monotonic in document order. `readingKey` (page, then
 * y within the page) is, and the fallback bisects on it.
 */
import type { CompiledStyle } from '../../style/types';
import { clamp } from '../flow/flowMath';
import type { Anchor, Placement } from '../flow/flowAnchor';
import type { SectionFrame } from '../flow/sectionFrame';
import { caretAt, rangeAtOffset, rangeTop, type SectionText } from '../flow/sectionText';
import type { SlotLayout } from '../flow/slotLayout';
import { firstVisibleProbe, readingKey, rowAlign, rowOf, type GridGeometry } from './gridMath';

const TEXT_NODE = 3;

/** What the anchor logic needs from GridSlots (kept structural for testing). */
export interface GridView {
  readonly scroller: HTMLElement;
  readonly layout: SlotLayout;
  readonly geometry: GridGeometry;
  frameAt(i: number): SectionFrame | null;
}

/** Monotonic reading-order key of a point in a section document (grid: readingKey; paged: column key). */
export type PointKey = (x: number, y: number) => number;

/** Reading key of the first (or, with `last`, the greatest) non-empty rect, at its vertical centre. */
function keyOf(rects: DOMRectList, key: PointKey, last: boolean): number {
  let out = -Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (r.height <= 0) continue;
    const k = key(r.left + 1, (r.top + r.bottom) / 2);
    if (!last) return k;
    out = Math.max(out, k);
  }
  return out;
}

/**
 * First visible character of a section whose document y `localY` is at the viewport top.
 * Caret hit-test on the left page first (cheap, exact); bisection on the reading key otherwise
 * (probe landed in an image, a gap, or an empty left page).
 */
export function firstVisibleInGrid(
  doc: Document,
  t: SectionText,
  localY: number,
  g: GridGeometry,
  lineH: number,
  emPx: number,
): Range {
  const p = firstVisibleProbe(localY, g, lineH);
  const probeY = p.y + 0.5 * lineH;
  const caret = caretAt(doc, Math.min(emPx, g.textW / 2), probeY);
  if (caret && caret.node.nodeType === TEXT_NODE) {
    const r = doc.createRange();
    r.setStart(caret.node, Math.min(caret.offset, (caret.node as Text).data.length));
    r.collapse(true);
    const top = rangeTop(r);
    const rects = r.getClientRects();
    const left = rects.length > 0 ? rects[0]!.left : 0;
    if (top !== null && (g.cols === 1 || left < g.frameW / 2) && top >= p.y - 1.2 * lineH && top <= probeY + 3 * lineH) return r;
  }
  return bisectByKey(doc, t, readingKey(0, p.y, g), (x, y) => readingKey(x, y, g));
}

/**
 * First character whose reading key is greater than `target`: bisection over inked text nodes,
 * then over the characters of the node found. Also used by the paginator (paged/pagedAnchor.ts).
 */
export function bisectByKey(doc: Document, t: SectionText, target: number, key: PointKey): Range {
  const inked = (t.inked ??= t.nodes.flatMap((n, i) => (/\S/.test(n.data) ? [i] : [])));
  const r = doc.createRange();
  const endKey = (i: number): number => {
    r.selectNodeContents(t.nodes[i]!);
    return keyOf(r.getClientRects(), key, true);
  };
  let lo = 0;
  let hi = inked.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (endKey(inked[mid]!) > target) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= inked.length) return rangeAtOffset(doc, t, t.total);
  const node = t.nodes[inked[lo]!]!;
  const charKey = (k: number): number => {
    r.setStart(node, k);
    r.setEnd(node, k + 1);
    return keyOf(r.getClientRects(), key, false);
  };
  let a = 0;
  let b = node.data.length - 1;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (charKey(mid) > target) b = mid;
    else a = mid + 1;
  }
  const out = doc.createRange();
  out.setStart(node, Math.max(0, a));
  out.collapse(true);
  return out;
}

/** Same shape as flow's Anchor, so flow's locatorOf / textAnchorOf apply unchanged. */
export function captureGridAnchor(v: GridView, style: CompiledStyle): Anchor {
  if (v.layout.count === 0) return { index: 0, range: null, viewportY: 0, fraction: 0 };
  const st = v.scroller.scrollTop;
  const lh = style.lineHeightPx;
  const index = v.layout.indexAt(st + 0.5 * lh);
  const top = v.layout.contentTop(index);
  const local = Math.max(0, st - top);
  const fraction = clamp(local / Math.max(1, v.layout.contentHeight(index)), 0, 1);
  const f = v.frameAt(index);
  const text = f?.text();
  if (!f?.doc || !text) return { index, range: null, viewportY: 0, fraction };
  const range = firstVisibleInGrid(f.doc, text, local, v.geometry, lh, style.fontSizePx);
  const y = rangeTop(range);
  return { index, range, viewportY: y === null ? 0 : top + y - st, fraction };
}

/** A captured range is usable only while its section has not been remounted (new document). */
export function liveRange(v: GridView, a: Pick<Anchor, 'index' | 'range'>): Range | null {
  const f = v.frameAt(a.index);
  return a.range && f?.doc && a.range.startContainer.ownerDocument === f.doc ? a.range : null;
}

/** Row-aligned scrollTop showing the anchor's row; `exact` = from live text, not the fraction. */
export function gridRestoreTarget(v: GridView, a: Anchor): { scrollTop: number; exact: boolean } {
  const top = v.layout.contentTop(a.index);
  const rowH = v.geometry.rowH;
  const range = liveRange(v, a);
  const y = range ? rangeTop(range) : null;
  if (y !== null) return { scrollTop: top + rowOf(y, rowH) * rowH, exact: true };
  return { scrollTop: rowAlign(top + a.fraction * v.layout.contentHeight(a.index), top, rowH), exact: false };
}

/** True when the view still shows the anchor's row at the viewport top (the "sticky" locator). */
export function showsAnchorRow(v: GridView, a: Pick<Anchor, 'index' | 'range'>): boolean {
  const range = liveRange(v, a);
  const y = range ? rangeTop(range) : null;
  if (y === null) return false;
  const rowH = v.geometry.rowH;
  const want = v.layout.contentTop(a.index) + rowOf(y, rowH) * rowH;
  return Math.abs(v.scroller.scrollTop - want) < 1;
}

/** The sticky anchor as an Anchor while its row is still at the viewport top; else null. */
export function stickyAnchor(v: GridView, s: { index: number; range: Range } | null): Anchor | null {
  if (!s || !showsAnchorRow(v, s)) return null;
  const top = v.layout.contentTop(s.index);
  const y = rangeTop(s.range) ?? 0;
  const fraction = clamp(y / Math.max(1, v.layout.contentHeight(s.index)), 0, 1);
  return { index: s.index, range: s.range, viewportY: top + y - v.scroller.scrollTop, fraction };
}

/** Turn a flow Placement (line y at the viewport top) into a row-aligned one (rowH read at placement time). */
export function rowAligned(place: Placement, rowH: () => number): Placement {
  return (f, top) => {
    const p = place(f, top);
    return p ? { y: rowAlign(p.y, top, rowH()), range: p.range } : null;
  };
}
