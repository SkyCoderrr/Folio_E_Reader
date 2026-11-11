import type { BookRecord, StatsQueryResult } from '@contract/types';
import { MIN_SPEED_MS, timeLeftMs } from '../features/stats/format';
import type { StatsBookVM, StatsDayVM } from '../features/stats/StatsPage';
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function statsRange(today = new Date()) {
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  return { fromDay: localDay(start), toDay: localDay(today) };
}
export function statsModel(
  result: StatsQueryResult,
  today = new Date(),
  library: BookRecord[] = [],
) {
  const days: StatsDayVM[] = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - 29 + i);
    const day = localDay(date);
    const row = result.days.find((d) => d.day === day);
    return { day, activeMs: row?.activeMs ?? 0, chars: row?.chars ?? 0 };
  });
  const books: StatsBookVM[] = result.books
    .filter((b) => b.activeMs > 0)
    .map((b) => {
      const rec = library.find((r) => r.id === b.bookId);
      const ok = b.activeMs >= MIN_SPEED_MS && b.chars > 0;
      return {
        ...b,
        charsPerMin: ok ? b.chars / (b.activeMs / 60000) : null,
        language: rec?.language ?? null,
        timeLeftMs: timeLeftMs({ ...b, totalChars: rec?.totalChars ?? null }),
        lastReadAt: b.lastReadAt === null ? null : new Date(b.lastReadAt).toISOString(),
      };
    });
  return { days, books, booksFinished: result.books.filter((b) => b.finished).length };
}

/** Per-book time left (ms) for the Library list; only books with 5+ active minutes. */
export function timeLeftByBook(result: StatsQueryResult, library: BookRecord[]) {
  const out: Record<string, number> = {};
  for (const b of result.books) {
    const rec = library.find((r) => r.id === b.bookId);
    const v = timeLeftMs({ ...b, totalChars: rec?.totalChars ?? null });
    if (v !== null) out[b.bookId] = v;
  }
  return out;
}
