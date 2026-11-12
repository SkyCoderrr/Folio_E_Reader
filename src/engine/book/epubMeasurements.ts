import type { EpubSectionChars } from '@contract/types';
import type { BookSource } from './BookSource';
import { buildSectionText } from '../renderers/flow/sectionText';
import { planTocAnchors, readTocOffsets } from '../../features/toc/tocOffsets';

/** Reuse successful measurements; only missing sections are read. Partial success is durable. */
export async function measureEpubSections(
  source: BookSource,
  cached: EpubSectionChars,
  onError: (reason: unknown) => void,
  cancelled: () => boolean,
): Promise<EpubSectionChars | null> {
  const matches = cached.sectionChars.length === source.sections.length;
  const sectionChars = matches ? [...cached.sectionChars] : source.sections.map(() => null);
  const offsets = new Map<string, number>(Object.entries(matches ? cached.tocFragmentOffsets : {}));
  const anchors = planTocAnchors(source, source.toc);
  // Let the mounted text paint first, then bound each batch so input/scrolling can run.
  let nextYield = performance.now();
  for (const [i, section] of source.sections.entries()) {
    if (cancelled()) return null;
    if (sectionChars[i] !== null) continue;
    if (performance.now() >= nextYield) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (cancelled()) return null;
      nextYield = performance.now() + 8;
    }
    try {
      const doc = await section.createDocument();
      if (cancelled()) return null;
      const text = buildSectionText(doc);
      sectionChars[i] = text.total;
      readTocOffsets(anchors, i, doc, text, offsets);
    } catch (e) {
      if (cancelled()) return null;
      onError(e);
    }
  }
  if (cancelled()) return null;
  return { fileHash: cached.fileHash, sectionChars, tocFragmentOffsets: Object.fromEntries(offsets) };
}
