import type { FooterProgress } from '@contract/types';
import type { TocPosition, TocSpan } from '../toc/tocModel';
import { classifyToc } from '../toc/tocModel';

/**
 * t31u footer readout text. Chapter = 1-based position of the current TOC entry among all TOC
 * entries that resolve to a section (flattened pre-order, every depth, same entries and "current"
 * rule as the TOC sidebar) / their count. No TOC (or position before the first entry) → no chapter
 * part; "both" then shows only the percentage. Percentage is the whole-book percent.
 */
export function footerReadout(
  mode: FooterProgress,
  spans: readonly TocSpan[],
  pos: TocPosition | null | undefined,
): string | null {
  if (mode === 'off' || !pos) return null;
  const parts: string[] = [];
  if (mode === 'chapter' || mode === 'both') {
    const resolved = spans.filter((s) => s.start !== null);
    const cur = classifyToc(spans, pos).currentKey;
    const idx = cur ? resolved.findIndex((s) => s.key === cur) : -1;
    if (idx >= 0) parts.push(`${idx + 1}/${resolved.length}`);
  }
  if (mode === 'percent' || mode === 'both') {
    const p = Math.min(1, Math.max(0, Number.isFinite(pos.progress) ? pos.progress : 0));
    parts.push(`${p >= 0.99995 ? 100 : Math.floor(p * 100)}%`);
  }
  return parts.length ? parts.join(' · ') : null;
}
