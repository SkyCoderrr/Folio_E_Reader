import type { FooterProgress } from '@contract/types';

/**
 * t31u footer readout text. Chapter = the current TOC entry's ordinal among the entries that
 * resolve to a section (tocOrdinal: flattened pre-order, every depth, the TOC sidebar's "current"
 * rule) / their count. No TOC (or position before the first entry) → no chapter part; "both" then
 * shows only the percentage. Percentage is the whole-book percent (Locator.progress, 1 at the end).
 */
export function footerReadout(
  mode: FooterProgress,
  chapter: { index: number; count: number } | null,
  progress: number | undefined,
): string | null {
  if (mode === 'off' || progress === undefined) return null;
  const parts: string[] = [];
  if ((mode === 'chapter' || mode === 'both') && chapter) parts.push(`${chapter.index}/${chapter.count}`);
  if (mode === 'percent' || mode === 'both') {
    const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    parts.push(`${p >= 0.99995 ? 100 : Math.floor(p * 100)}%`);
  }
  return parts.length ? parts.join(' · ') : null;
}
