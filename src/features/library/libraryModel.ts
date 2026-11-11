import type { BookRecord, LibrarySort } from '@contract/types';

export type SortDir = 'asc' | 'desc';
export type ProgressFilter = 'all' | 'reading' | 'unread' | 'finished';
export type FormatFilter = 'all' | 'epub' | 'txt';

export const FINISHED_AT = 0.995;

const collator = new Intl.Collator(['zh-Hans-u-co-pinyin', 'en'], {
  numeric: true,
  sensitivity: 'base',
});

/** Natural direction when a sort is first chosen. */
export function defaultSortDir(sort: LibrarySort): SortDir {
  return sort === 'title' || sort === 'author' ? 'asc' : 'desc';
}

export function isFinished(b: BookRecord): boolean {
  return b.finishedAt !== null || b.progress >= FINISHED_AT;
}

export function isNew(b: BookRecord): boolean {
  return b.progress <= 0 && b.lastOpenedAt === null && !isFinished(b);
}

export function sortBooks(books: BookRecord[], sort: LibrarySort, dir: SortDir): BookRecord[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byText = (a: string | null, b: string | null): number => {
    // Missing authors always sort last.
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return sign * collator.compare(a, b);
  };
  const cmp = (a: BookRecord, b: BookRecord): number => {
    switch (sort) {
      case 'title':
        return byText(a.title, b.title);
      case 'author':
        return byText(a.author, b.author);
      case 'progress':
        return sign * (a.progress - b.progress);
      case 'added':
        return sign * (a.addedAt - b.addedAt);
      case 'lastRead': {
        // Never-opened books sort after opened ones in either direction.
        if (a.lastOpenedAt === null && b.lastOpenedAt === null)
          return sign * (a.addedAt - b.addedAt);
        if (a.lastOpenedAt === null) return 1;
        if (b.lastOpenedAt === null) return -1;
        return sign * (a.lastOpenedAt - b.lastOpenedAt);
      }
    }
  };
  return [...books].sort(
    (a, b) => cmp(a, b) || collator.compare(a.title, b.title) || (a.id < b.id ? -1 : 1),
  );
}

/** Case-insensitive substring match over title and author. */
export function searchBooks(books: BookRecord[], query: string): BookRecord[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return books;
  return books.filter(
    (b) =>
      b.title.toLocaleLowerCase().includes(q) || (b.author ?? '').toLocaleLowerCase().includes(q),
  );
}

export function filterBooks(
  books: BookRecord[],
  filter: ProgressFilter,
  format: FormatFilter,
): BookRecord[] {
  return books.filter((b) => {
    if (format !== 'all' && b.format !== format) return false;
    switch (filter) {
      case 'all':
        return true;
      case 'finished':
        return isFinished(b);
      case 'unread':
        return b.progress <= 0 && !isFinished(b);
      case 'reading':
        return b.progress > 0 && !isFinished(b);
    }
  });
}

export function visibleBooks(
  books: BookRecord[],
  o: {
    sort: LibrarySort;
    sortDir: SortDir;
    filter: ProgressFilter;
    formatFilter: FormatFilter;
    query: string;
  },
): BookRecord[] {
  return sortBooks(
    searchBooks(filterBooks(books, o.filter, o.formatFilter), o.query),
    o.sort,
    o.sortDir,
  );
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Relative up to 7 days, then a short date. */
export function formatLastRead(ts: number | null, now: number = Date.now()): string {
  if (ts === null) return 'Never';
  const d = Math.max(0, now - ts);
  if (d < MIN) return 'Just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  const days = Math.floor(d / DAY);
  if (days === 1) return 'Yesterday';
  if (days <= 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Stable 0..359 hue from a book id (FNV-1a). */
export function coverHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/** Saturated, dark enough for white title text (>= 7:1). */
export function coverColor(id: string): string {
  return `hsl(${coverHue(id)} 55% 26%)`;
}

export function progressPercent(b: BookRecord): number {
  return Math.min(100, Math.max(0, Math.round(b.progress * 100)));
}
