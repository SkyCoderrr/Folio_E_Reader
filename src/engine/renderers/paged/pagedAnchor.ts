/**
 * Reading position in paged flow (ADR-004, ADR-005). The locator is the first visible character of
 * the view: the top of its left page (column) (PRD §9.4). A target character is shown by moving
 * the strip so that its column is the left page.
 */
import { bisectByKey } from '../grid/gridAnchor';
import { caretAt, type SectionText } from '../flow/sectionText';
import { columnOfX, pagedKey, type PagedGeometry } from './pagedMath';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function firstRect(list: DOMRectList): DOMRect | null {
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!;
    if (r.height > 0) return r;
  }
  return null;
}

/** Document point (left, top) where a range starts; null when it has no box. */
export function rangePoint(range: Range): { x: number; y: number } | null {
  const direct = firstRect(range.getClientRects());
  if (direct) return { x: direct.left, y: direct.top };
  const c = range.startContainer;
  const o = range.startOffset;
  const r2 = range.cloneRange();
  if (c.nodeType === TEXT_NODE) {
    const len = (c as Text).data.length;
    if (o < len) r2.setEnd(c, o + 1);
    else if (o > 0) r2.setStart(c, o - 1);
    const r = firstRect(r2.getClientRects());
    if (r) return { x: r.left, y: r.top };
  } else {
    const child = c.childNodes[o] ?? c;
    if (child.nodeType === ELEMENT_NODE) return elementPoint(child as Element);
    r2.selectNodeContents(child);
    const r = firstRect(r2.getClientRects());
    if (r) return { x: r.left, y: r.top };
  }
  const el = c.nodeType === ELEMENT_NODE ? (c as Element) : c.parentElement;
  return el ? elementPoint(el) : null;
}

/** First fragment of an element (a block split across columns has one rect per column). */
export function elementPoint(el: Element): { x: number; y: number } {
  const r = firstRect(el.getClientRects()) ?? el.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

/** Column (page) holding a range or element in a section document; null when it has no box. */
export function columnOfTarget(target: Range | Element, g: Pick<PagedGeometry, 'pitch'>): number | null {
  const p = 'nodeType' in target ? elementPoint(target) : rangePoint(target);
  if (!p) return null;
  return columnOfX(p.x + 1, g.pitch);
}

/**
 * First visible character of column `col`: caret hit-test at its top (cheap, exact); bisection on
 * the column key otherwise (image, blank column top, short last page).
 */
export function firstVisibleInColumn(
  doc: Document,
  t: SectionText,
  col: number,
  g: PagedGeometry,
  lineH: number,
  emPx: number,
): Range {
  const x0 = col * g.pitch;
  const probeY = 0.5 * lineH;
  const caret = caretAt(doc, x0 + Math.min(emPx, g.textW / 2), probeY);
  if (caret && caret.node.nodeType === TEXT_NODE) {
    const r = doc.createRange();
    r.setStart(caret.node, Math.min(caret.offset, (caret.node as Text).data.length));
    r.collapse(true);
    const p = rangePoint(r);
    if (p && columnOfX(p.x + 1, g.pitch) === col && p.y <= probeY + 3 * lineH) return r;
  }
  return bisectByKey(doc, t, pagedKey(x0, 0, g), (x, y) => pagedKey(x, y, g));
}

/** Content right edge (document x) of a section: union of every box in its body. */
export function contentRight(doc: Document): number {
  const body = doc.body ?? doc.documentElement;
  if (!body) return 0;
  const r = doc.createRange();
  r.selectNodeContents(body);
  const rect = r.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect.right : 0;
}
