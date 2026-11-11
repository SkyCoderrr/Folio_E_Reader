/**
 * Reading-position logic for FlowRenderer: capture the first visible character (PRD §9.4) as an
 * Anchor, restore it after a relayout, turn it into a Locator, and turn a Locator / href back into
 * a placement (where to scroll once the target section is mounted).
 */
import type { Locator } from '@contract/types';
import type { ResolvedHref } from '../../book/BookSource';
import type { CompiledStyle } from '../../style/types';
import { bookProgress, clamp, locateProgress } from './flowMath';
import type { FlowSlots, TextAnchor } from './flowSlots';
import type { SectionFrame } from './sectionFrame';
import {
  firstVisibleRange,
  offsetOfBoundary,
  rangeAtOffset,
  rangeTop,
  sectionString,
  snippetAt,
  targetTop,
} from './sectionText';
import { findNearestSnippet } from './textOffsets';

/** Optional CFI / TXT bridge, implemented by locator.ts (M1.5b) on top of foliate-js epubcfi. */
export interface LocatorBridge {
  cfiFromRange?(sectionIndex: number, range: Range): string | null;
  parseCfi?(cfi: string): { sectionIndex: number; toRange(doc: Document): Range | null } | null;
  globalCharOffset?(sectionIndex: number, charOffset: number): number | null;
  fromGlobalCharOffset?(
    globalCharOffset: number,
  ): { sectionIndex: number; charOffset: number } | null;
}

export interface Anchor {
  index: number;
  /** Live range at the first visible character; null when the section is not mounted. */
  range: Range | null;
  /** Viewport offset (px from the scroller top) of the anchor line. */
  viewportY: number;
  /** Fallback: position of the viewport top inside the section content, 0..1. */
  fraction: number;
}

/** Track y of the line to bring to the viewport top, once the target section is mounted. */
export type Placement = (
  frame: SectionFrame,
  contentTop: number,
) => { y: number; range: Range | null } | null;

export function captureAnchor(slots: FlowSlots, style: CompiledStyle): Anchor {
  if (slots.layout.count === 0) return { index: 0, range: null, viewportY: 0, fraction: 0 };
  const st = slots.scroller.scrollTop;
  const lh = style.lineHeightPx;
  const index = slots.layout.indexAt(st + 0.5 * lh);
  const top = slots.layout.contentTop(index);
  const fraction = clamp((st - top) / Math.max(1, slots.layout.contentHeight(index)), 0, 1);
  const f = slots.frameAt(index);
  const text = f?.text();
  if (!f?.doc || !text) return { index, range: null, viewportY: 0, fraction };
  const range = firstVisibleRange(f.doc, text, Math.max(0, st - top), lh, style.fontSizePx);
  const y = rangeTop(range);
  return { index, range, viewportY: y === null ? 0 : top + y - st, fraction };
}

/** scrollTop that puts the anchor back at its viewport offset; `exact` = text-level, not fraction. */
export function restoreTarget(slots: FlowSlots, a: Anchor): { scrollTop: number; exact: boolean } {
  const top = slots.layout.contentTop(a.index);
  const f = slots.frameAt(a.index);
  // The range is only valid if the section was not remounted (new document) since capture.
  const live = a.range !== null && !!f?.doc && a.range.startContainer.ownerDocument === f.doc;
  const y = live ? rangeTop(a.range!) : null;
  if (y !== null) return { scrollTop: top + y - a.viewportY, exact: true };
  return { scrollTop: top + a.fraction * slots.layout.contentHeight(a.index), exact: false };
}

export function textAnchorOf(a: Anchor): TextAnchor | null {
  if (!a.range) return null;
  const top = rangeTop(a.range);
  return top === null ? null : { index: a.index, range: a.range, docY: top };
}

/** `slots` only needs `frameAt` (also used by PageGridRenderer with GridSlots). */
export function locatorOf(
  slots: Pick<FlowSlots, 'frameAt'>,
  a: Anchor,
  sizes: ArrayLike<number>,
  bridge?: LocatorBridge,
): Locator {
  const text = slots.frameAt(a.index)?.text();
  let charOffset = 0;
  let snippet = '';
  let cfi: string | null = null;
  let fraction = a.fraction;
  if (a.range && text) {
    charOffset = offsetOfBoundary(text, a.range.startContainer, a.range.startOffset);
    snippet = snippetAt(text, charOffset);
    fraction = text.total > 0 ? charOffset / text.total : 0;
    cfi = bridge?.cfiFromRange?.(a.index, a.range) ?? null;
  }
  return {
    sectionIndex: a.index,
    cfi,
    charOffset,
    globalCharOffset: bridge?.globalCharOffset?.(a.index, charOffset) ?? null,
    progress: bookProgress(sizes, a.index, fraction),
    snippet,
  };
}

/** Place a char offset at the top; a snippet re-anchors to the nearest matching text. */
export function offsetPlacement(offset: number, snippet: string): Placement {
  return (f, top) => {
    const text = f.text();
    if (!f.doc || !text) return null;
    let off = clamp(Math.floor(offset), 0, text.total);
    if (snippet) {
      const found = findNearestSnippet(sectionString(text), snippet, off);
      if (found >= 0) off = found;
    }
    const range = rangeAtOffset(f.doc, text, off);
    return { y: top + (rangeTop(range) ?? 0), range };
  };
}

/** foliate-js anchors may also return 0 ("section start"); every falsy value means section start. */
export function hrefPlacement(r: ResolvedHref): Placement {
  return (f, top) => {
    const t = f.doc && r.anchor ? r.anchor(f.doc) : null;
    const y = t ? targetTop(t) : 0;
    const range = t && !('nodeType' in t) ? t : null;
    return { y: top + (y ?? 0), range };
  };
}

/**
 * TXT prioritizes globalCharOffset across chapter changes. EPUB keeps CFI → local → progress.
 * Each attempt returns [sectionIndex, placement].
 */
export function locatorAttempts(
  loc: Locator,
  sizes: ArrayLike<number>,
  bridge?: LocatorBridge,
): Array<() => [number, Placement] | null> {
  const global =
    loc.globalCharOffset !== null ? bridge?.fromGlobalCharOffset?.(loc.globalCharOffset) : null;
  const attempts: Array<() => [number, Placement] | null> = [
    // TXT positions survive chapter re-detection: the old section index can still be valid
    // while pointing at an entirely different part of the book. EPUB has no global bridge.
    () => {
      const parsed = loc.cfi ? bridge?.parseCfi?.(loc.cfi) : null;
      if (!parsed) return null;
      return [
        parsed.sectionIndex,
        (f, top) => {
          const range = f.doc ? parsed.toRange(f.doc) : null;
          const y = range ? rangeTop(range) : null;
          return range && y !== null ? { y: top + y, range } : null;
        },
      ];
    },
    () => [loc.sectionIndex, offsetPlacement(loc.charOffset, loc.snippet)],
    () => {
      const g =
        loc.globalCharOffset !== null ? bridge?.fromGlobalCharOffset?.(loc.globalCharOffset) : null;
      return g ? [g.sectionIndex, offsetPlacement(g.charOffset, loc.snippet)] : null;
    },
    () => {
      const p = locateProgress(sizes, loc.progress);
      return [
        p.index,
        (f, top) => offsetPlacement(Math.round(p.fraction * (f.text()?.total ?? 0)), '')(f, top),
      ];
    },
  ];
  // A virtualized section may not have a DOM range yet. Its zero offset is a
  // placeholder, not evidence that the reader is at the section start. Restore
  // its measured/estimated fraction before trying that placeholder offset.
  if (!loc.cfi && !loc.snippet && loc.charOffset === 0 &&
      loc.progress > bookProgress(sizes, loc.sectionIndex, 0) + 1e-9) {
    attempts.unshift(attempts.pop()!);
  }
  if (global)
    attempts.unshift(() => [global.sectionIndex, offsetPlacement(global.charOffset, loc.snippet)]);
  return attempts;
}
