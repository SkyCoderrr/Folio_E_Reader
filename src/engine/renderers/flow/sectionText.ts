/**
 * DOM side of Locator offsets inside one section document (definition in textOffsets.ts).
 * Never uses `instanceof` (nodes live in the iframe's realm) and never passes callbacks into the
 * iframe document (TreeWalker filters etc.), so it works with `sandbox` without `allow-scripts`.
 */
import { buildStarts, locateOffset, makeSnippet, SNIPPET_CHARS } from './textOffsets';

const SKIP_PARENTS = new Set(['script', 'style', 'template', 'noscript']);
const SHOW_TEXT = 4;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export interface SectionText {
  nodes: Text[];
  starts: number[];
  lengths: number[];
  total: number;
  nodeIndex?: Map<Node, number>;
  joined?: string;
  /** Indices of nodes containing non-whitespace (whitespace-only nodes often have no boxes). */
  inked?: number[];
}

export function buildSectionText(doc: Document): SectionText {
  const root = doc.body ?? doc.documentElement;
  const nodes: Text[] = [];
  const lengths: number[] = [];
  if (root) {
    const walker = doc.createTreeWalker(root, SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      const p = t.parentNode;
      if (p && p.nodeType === ELEMENT_NODE && SKIP_PARENTS.has((p as Element).localName)) continue;
      if (t.data.length === 0) continue;
      nodes.push(t);
      lengths.push(t.data.length);
    }
  }
  const { starts, total } = buildStarts(lengths);
  return { nodes, starts, lengths, total };
}

export function sectionString(t: SectionText): string {
  return (t.joined ??= t.nodes.map((n) => n.data).join(''));
}

export function snippetAt(t: SectionText, offset: number): string {
  return makeSnippet(sectionString(t).slice(offset, offset + SNIPPET_CHARS * 2));
}

export function rangeAtOffset(doc: Document, t: SectionText, offset: number): Range {
  const r = doc.createRange();
  const loc = locateOffset(t, offset);
  const node = loc ? t.nodes[loc.node] : undefined;
  if (loc && node) r.setStart(node, loc.inner);
  else r.setStart(doc.body ?? doc.documentElement, 0);
  r.collapse(true);
  return r;
}

/** Section char offset of a DOM boundary point (caret, range start, element anchor). */
export function offsetOfBoundary(t: SectionText, node: Node, offset: number): number {
  if (node.nodeType === TEXT_NODE) {
    const map = (t.nodeIndex ??= new Map<Node, number>(t.nodes.map((n, i) => [n, i])));
    const i = map.get(node);
    if (i !== undefined) return (t.starts[i] ?? 0) + Math.min(offset, t.lengths[i] ?? 0);
  }
  const doc = node.ownerDocument;
  if (!doc || t.nodes.length === 0) return 0;
  const r = doc.createRange();
  try {
    r.setStart(node, offset);
  } catch {
    return 0;
  }
  r.collapse(true);
  // First text node whose start is at or after the boundary.
  let lo = 0;
  let hi = t.nodes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r.comparePoint(t.nodes[mid]!, 0) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo < t.nodes.length ? (t.starts[lo] ?? 0) : t.total;
}

function firstRectTop(list: DOMRectList): number | null {
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!;
    if (r.height > 0) return r.top;
  }
  return null;
}

/** Top (document px) of the line a range or node starts on; null when it has no box. */
export function rangeTop(range: Range): number | null {
  const direct = firstRectTop(range.getClientRects());
  if (direct !== null) return direct;
  const c = range.startContainer;
  const o = range.startOffset;
  const r2 = range.cloneRange();
  if (c.nodeType === TEXT_NODE) {
    const len = (c as Text).data.length;
    if (o < len) r2.setEnd(c, o + 1);
    else if (o > 0) r2.setStart(c, o - 1);
    const t = firstRectTop(r2.getClientRects());
    if (t !== null) return t;
  } else {
    const child = c.childNodes[o] ?? c;
    if (child.nodeType === ELEMENT_NODE) return (child as Element).getBoundingClientRect().top;
    r2.selectNodeContents(child);
    const t = firstRectTop(r2.getClientRects());
    if (t !== null) return t;
  }
  const el = c.nodeType === ELEMENT_NODE ? (c as Element) : c.parentElement;
  return el ? el.getBoundingClientRect().top : null;
}

export function targetTop(target: Element | Range): number | null {
  return 'nodeType' in target ? target.getBoundingClientRect().top : rangeTop(target);
}

interface CaretDoc {
  caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?(x: number, y: number): Range | null;
}

/** Caret position at a point in `doc` (also used by grid/gridAnchor.ts). */
export function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as unknown as CaretDoc;
  if (typeof d.caretPositionFromPoint === 'function') {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === 'function') {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/**
 * First visible character of a section whose document top is `topY` px above the viewport top
 * (topY in document coordinates). PRD §9.4: caret at (content left + 1 em, top + 0.5 line);
 * if the caret lands outside the band around the viewport top (margins, images, gaps), fall back
 * to a binary search over text nodes and then characters.
 */
export function firstVisibleRange(doc: Document, t: SectionText, topY: number, lineH: number, emPx: number): Range {
  const body = doc.body ?? doc.documentElement;
  const x = (body ? body.getBoundingClientRect().left : 0) + emPx;
  const probeY = topY + 0.5 * lineH;
  const caret = caretAt(doc, x, probeY);
  if (caret && caret.node.nodeType === TEXT_NODE) {
    const r = doc.createRange();
    r.setStart(caret.node, Math.min(caret.offset, (caret.node as Text).data.length));
    r.collapse(true);
    const top = rangeTop(r);
    if (top !== null && top >= topY - 1.2 * lineH && top <= probeY + 3 * lineH) return r;
  }
  return bisectFirstVisible(doc, t, topY + 1);
}

function bisectFirstVisible(doc: Document, t: SectionText, y: number): Range {
  const inked = (t.inked ??= t.nodes.flatMap((n, i) => (/\S/.test(n.data) ? [i] : [])));
  const r = doc.createRange();
  const bottomOf = (i: number): number => {
    r.selectNodeContents(t.nodes[i]!);
    return r.getBoundingClientRect().bottom;
  };
  let lo = 0;
  let hi = inked.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(inked[mid]!) > y) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= inked.length) return rangeAtOffset(doc, t, t.total);
  const node = t.nodes[inked[lo]!]!;
  const charBottom = (k: number): number => {
    r.setStart(node, k);
    r.setEnd(node, k + 1);
    const rects = r.getClientRects();
    for (let i = 0; i < rects.length; i++) if (rects[i]!.height > 0) return rects[i]!.bottom;
    return -Infinity; // collapsed whitespace: treat as not yet visible
  };
  let a = 0;
  let b = node.data.length - 1;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (charBottom(mid) > y) b = mid;
    else a = mid + 1;
  }
  const out = doc.createRange();
  out.setStart(node, Math.max(0, a));
  out.collapse(true);
  return out;
}
