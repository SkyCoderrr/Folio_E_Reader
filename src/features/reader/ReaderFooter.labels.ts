import type { BookSource, TocItem } from '../../engine/book/BookSource';

/**
 * Chapter label for every section: the last TOC entry (any depth, document order) that starts at
 * or before the section. Sections before the first TOC entry get null.
 */
export function sectionChapterLabels(
  source: Pick<BookSource, 'sections' | 'toc' | 'resolveHref'>,
): (string | null)[] {
  const starts = new Map<number, string>();
  const walk = (items: readonly TocItem[] | null | undefined) => {
    for (const item of items ?? []) {
      const label = item.label?.trim();
      let index: number | undefined;
      try {
        index = source.resolveHref(item.href)?.index;
      } catch {
        index = undefined;
      }
      // First entry pointing into a section names it (a later sub-entry is a heading inside it).
      if (label && index !== undefined && !starts.has(index)) starts.set(index, label);
      walk(item.subitems);
    }
  };
  walk(source.toc);
  const out: (string | null)[] = [];
  let current: string | null = null;
  for (let i = 0; i < source.sections.length; i++) {
    current = starts.get(i) ?? current;
    out.push(current);
  }
  return out;
}

/** "31.4%" with one decimal; clamps to 0..100. */
export function formatProgress(progress: number | undefined): string {
  const p = Math.min(1, Math.max(0, progress ?? 0));
  return `${(p * 100).toFixed(1)}%`;
}
