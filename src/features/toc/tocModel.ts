import type { TocItem } from '../../engine/book/BookSource';

export interface TocRow {
  key: string;
  label: string;
  href: string;
  level: number; // 1-based (aria-level)
  parent: string | null;
  hasChildren: boolean;
}

/** Flatten a TOC; a row is visible when every ancestor is in `expanded`. */
export function flattenToc(toc: TocItem[], expanded: ReadonlySet<string>): TocRow[] {
  const out: TocRow[] = [];
  const walk = (items: TocItem[], level: number, parent: string | null, prefix: string) => {
    items.forEach((it, i) => {
      const key = `${prefix}${i}`;
      const kids = it.subitems ?? [];
      out.push({ key, label: it.label, href: it.href, level, parent, hasChildren: kids.length > 0 });
      if (kids.length && expanded.has(key)) walk(kids, level + 1, key, `${key}.`);
    });
  };
  walk(toc, 1, null, '');
  return out;
}

/** Label of the entry with row key `key` ("2", "2.0", ...); null when absent. */
export function tocLabelAt(toc: TocItem[], key: string): string | null {
  let items: TocItem[] | null | undefined = toc;
  let item: TocItem | undefined;
  for (const part of key.split('.')) {
    item = items?.[Number(part)];
    if (!item) return null;
    items = item.subitems;
  }
  return item?.label.trim() || null;
}

/** Default expansion: top level open (so 2 levels show); level 2+ collapsed behind chevrons. */
export function defaultExpanded(toc: TocItem[]): Set<string> {
  const s = new Set<string>();
  toc.forEach((it, i) => {
    if (it.subitems?.length) s.add(String(i));
  });
  return s;
}

/** Keys of the ancestors of the first item whose href matches (so it can be revealed). */
export function ancestorsOf(toc: TocItem[], href: string | null): string[] {
  if (!href) return [];
  const walk = (items: TocItem[], prefix: string, trail: string[]): string[] | null => {
    for (let i = 0; i < items.length; i++) {
      const key = `${prefix}${i}`;
      if (items[i].href === href) return trail;
      const kids = items[i].subitems ?? [];
      const r = kids.length ? walk(kids, `${key}.`, [...trail, key]) : null;
      if (r) return r;
    }
    return null;
  };
  return walk(toc, '', []) ?? [];
}

// ───────────────────────── reading state (t24u) ─────────────────────────

export interface TocBookInfo {
  /** Book-level TOC href → section index (null = unknown / external). */
  resolve: (href: string) => number | null;
  /** Per-section weights: the same basis as Locator.progress (LocatorBridge.sectionChars). */
  weights: readonly number[];
  /** Persisted chapter id of an entry starting in section `start` (see chapterKeyFor / txtChapterKey). */
  chapterKey: (start: number, href: string) => string;
  /**
   * Book-level TOC href → char offset of its #fragment inside its section (0 = section start).
   * Several entries can share one spine section and differ only by fragment (EPUB).
   */
  offsets?: ReadonlyMap<string, number>;
  /** true while the fragment offsets are still being measured: position-based marking must wait. */
  pending?: boolean;
}

/** The reader's position as far as the TOC cares (a Locator satisfies it). */
export interface TocPosition {
  sectionIndex: number;
  progress: number;
  /** UTF-16 offset of the first visible character inside the section; absent = section start. */
  charOffset?: number;
}

export interface TocSpan {
  key: string;
  href: string;
  /** Stable persisted id of the entry (see chapterKeyFor); null when the href does not resolve. */
  chapterKey: string | null;
  /** Section index the entry starts in; null when the href does not resolve. */
  start: number | null;
  /** Char offset of the entry's #fragment inside section `start` (0 = section start). */
  offset: number;
  /** Book fraction (0..1) where the entry starts / ends (end = next entry that starts later). */
  from: number;
  to: number;
  /**
   * t32u: true while the #fragment offsets are still being measured (TocBookInfo.pending) and another
   * entry starts in the same section, so where this entry starts inside it is not known yet.
   */
  unsure: boolean;
}

export interface TocReading {
  /** Row key of the last-read chapter (the entry containing the position). */
  currentKey: string | null;
  currentHref: string | null;
  currentChapterKey: string | null;
  /** Whole percent 0..100 for the current entry only; 100 only at the very end of the book. */
  percent: number | null;
  /**
   * t32u: the position is in a section whose entries cannot be told apart yet (offsets pending).
   * Nothing is current then; callers must not fall back to a section-level guess either.
   */
  unsure?: boolean;
}

/**
 * Persisted EPUB chapter id. Opaque to Rust (non-empty, <= 512 bytes). Derived only from the book's
 * own structure (spine index + href fragment), so it survives reopen and re-layout.
 */
export function chapterKeyFor(start: number, href: string): string {
  const hash = href.indexOf('#');
  return `s:${start}#${hash >= 0 ? href.slice(hash + 1) : ''}`;
}

/**
 * Persisted TXT chapter id (#5): the chapter's first character in the decoded text, with the
 * encoding that decoded it. A re-split (chapter pattern, fallback size) keeps the id of every
 * chapter that still starts at the same character and gives moved or new chapters new ids, so a
 * read mark never lands on a different chapter. Old "t:<index>" keys simply stop matching.
 */
export function txtChapterKey(encoding: string, startChar: number): string {
  return `t:${encoding}@${startChar}`;
}

/** Pre-order list of entries with their book-fraction spans (build once per book). */
export function buildTocSpans(toc: TocItem[], info: TocBookInfo): TocSpan[] {
  const weights = info.weights;
  const total = weights.reduce((a, b) => a + Math.max(0, b || 0), 0);
  const cum: number[] = [0];
  weights.forEach((s, i) => cum.push(cum[i] + Math.max(0, s || 0)));
  const frac = (section: number, offset: number) => {
    if (total <= 0) return section / Math.max(1, weights.length);
    const at = Math.min(Math.max(section, 0), cum.length - 1);
    const inside = Math.min(Math.max(0, offset), Math.max(0, weights[at] || 0));
    return (cum[at] + inside) / total;
  };
  const out: TocSpan[] = [];
  const walk = (items: TocItem[], prefix: string) =>
    items.forEach((it, i) => {
      const key = `${prefix}${i}`;
      const start = info.resolve(it.href);
      const offset = start === null ? 0 : Math.max(0, info.offsets?.get(it.href) ?? 0);
      out.push({
        key,
        href: it.href,
        chapterKey: start === null ? null : info.chapterKey(start, it.href),
        start,
        offset,
        from: start === null ? 0 : frac(start, offset),
        to: 1,
        unsure: false,
      });
      if (it.subitems?.length) walk(it.subitems, `${key}.`);
    });
  walk(toc, '');
  const placed = out.filter((s) => s.start !== null);
  if (info.pending) {
    const hrefs = new Map<number, Set<string>>();
    for (const s of placed) hrefs.set(s.start!, (hrefs.get(s.start!) ?? new Set()).add(s.href));
    for (const s of placed) s.unsure = hrefs.get(s.start!)!.size > 1;
  }
  // end = the start of the nearest entry that starts later in the book (section, then offset):
  // in position order that is the next distinct position (`from` grows with the position).
  const sorted = [...placed].sort((a, b) => a.start! - b.start! || a.offset - b.offset);
  let to = 1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i]!;
    const next = sorted[i + 1];
    if (next && comesBefore(s, next)) to = next.from;
    s.to = Math.max(s.from, to);
  }
  return out;
}

const comesBefore = (a: { start: number | null; offset: number }, b: { start: number | null; offset: number }) =>
  (a.start as number) < (b.start as number) || (a.start === b.start && a.offset < b.offset);

/**
 * The current (last-read) entry is the last entry whose start (section, then #fragment offset) is
 * at or before the reader's position; among entries starting at the same place the first in
 * document order wins and its deepest same-start child is taken. Nothing else is inferred from
 * position order (t28u): which other chapters count as read is decided only by the visit memory.
 */
export function classifyToc(
  spans: readonly TocSpan[],
  pos: TocPosition | null | undefined,
): TocReading {
  const none: TocReading = { currentKey: null, currentHref: null, currentChapterKey: null, percent: null };
  if (!pos) return none;
  const at = { start: pos.sectionIndex, offset: Math.max(0, pos.charOffset ?? 0) };
  let cur: TocSpan | undefined;
  for (const s of spans) {
    if (s.start === null || comesBefore(at, s)) continue; // starts after the reader
    if (!cur || comesBefore(cur, s)) cur = s;
  }
  if (!cur) return none;
  if (cur.unsure) return { ...none, unsure: true };
  for (;;) {
    const parent: TocSpan = cur;
    const kid = spans.find(
      (s) => s.start === parent.start && s.offset === parent.offset && s.key.startsWith(`${parent.key}.`),
    );
    if (!kid) break;
    cur = kid;
  }
  const progress = Math.min(1, Math.max(0, Number.isFinite(pos.progress) ? pos.progress : 0));
  const span = cur.to - cur.from;
  const p = span > 0 ? Math.min(1, Math.max(0, (progress - cur.from) / span)) : 0;
  const finished = cur.to >= 1 && progress >= 0.99995;
  const percent = finished ? 100 : Math.min(99, Math.round(p * 100));
  return { currentKey: cur.key, currentHref: cur.href, currentChapterKey: cur.chapterKey, percent };
}

/** 1-based ordinal of entry `key` among the entries that resolve (pre-order, every depth) / their count. */
export function tocOrdinal(spans: readonly TocSpan[], key: string | null): { index: number; count: number } | null {
  if (!key) return null;
  let count = 0;
  let index = 0;
  for (const s of spans) {
    if (s.start === null) continue;
    count++;
    if (s.key === key) index = count;
  }
  return index ? { index, count } : null;
}
