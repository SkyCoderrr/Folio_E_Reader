import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { TocItem } from '../../engine/book/BookSource';
import { ChapterMemory, type ChapterReadApi } from './chapterMemory';
import { buildTocSpans, classifyToc, type TocBookInfo, type TocPosition } from './tocModel';


/** Loads the persisted read set for the book and marks the chapter the reader dwells in. */
export function useChapterMemory(opts: {
  bookId: string;
  api: ChapterReadApi;
  toc: TocItem[];
  tocBook: TocBookInfo | null;
  position: TocPosition | null | undefined;
  /** false while the reader is not actually showing text (boss key, etc.) */
  active?: boolean;
  dwellMs?: number;
}): ReadonlySet<string> {
  const { bookId, api, toc, tocBook, position, active = true, dwellMs } = opts;
  const memory = useMemo(() => new ChapterMemory(bookId, api, dwellMs), [bookId, api, dwellMs]);
  useEffect(() => {
    memory.start(); // idempotent: survives StrictMode's mount/unmount/mount
    return () => memory.dispose();
  }, [memory]);
  const readKeys = useSyncExternalStore(
    memory.subscribe,
    memory.getSnapshot,
  );
  const spans = useMemo(() => (tocBook ? buildTocSpans(toc, tocBook) : []), [toc, tocBook]);
  // While the #fragment offsets are still being measured the current entry would be a guess
  // (the first entry of the section): never mark anything from it.
  const pending = tocBook?.pending === true;
  const chapterKey = useMemo(
    () => (pending ? null : classifyToc(spans, position).currentChapterKey),
    [spans, pending, position?.sectionIndex, position?.progress, position?.charOffset], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    memory.visit(active ? chapterKey : null);
  }, [memory, chapterKey, active]);
  return readKeys;
}
