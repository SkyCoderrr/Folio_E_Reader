/**
 * Pure helpers for Locator.charOffset (PRD §9.4, contract: UTF-16 code units).
 * Definition used by FlowRenderer (and to be reused by locator.ts, M1.5b): the section text is the
 * concatenation, in document order, of every Text node under <body>, excluding text whose parent is
 * <script>, <style>, <template> or <noscript>. charOffset indexes into that string.
 */

export interface OffsetTable {
  /** starts[i] = offset of text node i. Ascending. */
  starts: ArrayLike<number>;
  /** lengths[i] = length of text node i (> 0). */
  lengths: ArrayLike<number>;
  total: number;
}

/**
 * Map a section char offset to (text node index, offset inside it). Offsets are clamped to
 * [0, total]. An offset exactly at a node boundary maps to the START of the next node (so the
 * caret lands on the visible character), except at the very end. null when there is no text.
 */
export function locateOffset(t: OffsetTable, offset: number): { node: number; inner: number } | null {
  const n = t.starts.length;
  if (n === 0) return null;
  const off = Math.min(Math.max(0, Math.floor(offset)), t.total);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((t.starts[mid] ?? 0) <= off) lo = mid;
    else hi = mid - 1;
  }
  const inner = Math.min(off - (t.starts[lo] ?? 0), t.lengths[lo] ?? 0);
  return { node: lo, inner };
}

/** Build the starts table from node lengths. */
export function buildStarts(lengths: ArrayLike<number>): { starts: number[]; total: number } {
  const starts: number[] = new Array<number>(lengths.length);
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    starts[i] = acc;
    acc += lengths[i] ?? 0;
  }
  return { starts, total: acc };
}

export const SNIPPET_CHARS = 32;

/** Locator.snippet: whitespace collapsed, trimmed, at most `max` UTF-16 units (no split surrogate). */
export function makeSnippet(raw: string, max = SNIPPET_CHARS): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return s.slice(0, end);
}

/**
 * Fuzzy re-anchoring: find the occurrence of `snippet` (whitespace-insensitive) in `text`
 * nearest to `expected`, searching at most `radius` chars either side. Returns the char offset
 * in `text`, or -1. Used when charOffset drifted (e.g. the book file changed).
 */
export function findNearestSnippet(text: string, snippet: string, expected: number, radius = 4000): number {
  const words = snippet.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1;
  const pattern = words.map(escapeRegExp).join('\\s+');
  const from = Math.max(0, Math.floor(expected) - radius);
  const to = Math.min(text.length, Math.floor(expected) + radius + snippet.length);
  const hay = text.slice(from, to);
  const re = new RegExp(pattern, 'g');
  let best = -1;
  let bestDist = Infinity;
  for (let m = re.exec(hay); m; m = re.exec(hay)) {
    const at = from + m.index;
    const d = Math.abs(at - expected);
    if (d < bestDist) {
      best = at;
      bestDist = d;
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  return best;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
