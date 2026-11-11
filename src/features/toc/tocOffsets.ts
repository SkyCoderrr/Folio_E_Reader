import type { BookSource, TocItem } from '../../engine/book/BookSource';
import { buildSectionText, offsetOfBoundary, type SectionText } from '../../engine/renderers/flow/sectionText';

/** One TOC href whose fragment has to be located inside its section document. */
export interface AnchorTarget {
  href: string;
  anchor: (doc: Document) => Element | Range | number | null;
}

/** Section index → the TOC entries (with a fragment) that start inside that section. */
export type AnchorPlan = Map<number, AnchorTarget[]>;

/** Every TOC href (any depth) that resolves to a section and carries a #fragment. */
export function planTocAnchors(source: BookSource, toc: TocItem[]): AnchorPlan {
  const plan: AnchorPlan = new Map();
  const seen = new Set<string>();
  const walk = (items: TocItem[]) => {
    for (const it of items) {
      if (it.href.includes('#') && !seen.has(it.href)) {
        seen.add(it.href);
        const r = source.resolveHref(it.href);
        if (r?.anchor) {
          const list = plan.get(r.index) ?? [];
          list.push({ href: it.href, anchor: r.anchor });
          plan.set(r.index, list);
        }
      }
      if (it.subitems?.length) walk(it.subitems);
    }
  };
  walk(toc);
  return plan;
}

/**
 * Char offset (the same UTF-16 body-text measure as Locator.charOffset) of each planned fragment
 * in section `index`, written into `out`. A fragment that cannot be found stays at section start.
 */
export function readTocOffsets(
  plan: AnchorPlan,
  index: number,
  doc: Document,
  text: SectionText,
  out: Map<string, number>,
): void {
  for (const target of plan.get(index) ?? []) {
    let at = 0;
    try {
      const hit = target.anchor(doc);
      if (hit && typeof hit === 'object') {
        if ('startContainer' in hit) at = offsetOfBoundary(text, hit.startContainer, hit.startOffset);
        else at = offsetOfBoundary(text, hit, 0);
      }
    } catch {
      at = 0;
    }
    out.set(target.href, Math.min(Math.max(0, at), text.total));
  }
}

/** Convenience for tests / one-off use: measure a whole source. */
export async function measureToc(
  source: BookSource,
  toc: TocItem[],
): Promise<{ chars: number[]; offsets: Map<string, number> }> {
  const plan = planTocAnchors(source, toc);
  const chars: number[] = [];
  const offsets = new Map<string, number>();
  for (let i = 0; i < source.sections.length; i++) {
    const doc = await source.sections[i].createDocument();
    const text = buildSectionText(doc);
    chars.push(text.total);
    readTocOffsets(plan, i, doc, text, offsets);
  }
  return { chars, offsets };
}
