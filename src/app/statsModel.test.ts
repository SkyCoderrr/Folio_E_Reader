import { expect, it } from 'vitest';
import type { StatsQueryResult } from '@contract/types';
import { statsModel, statsRange } from './statsModel';
it('fills thirty local calendar days across year boundaries and joins stable book stats', () => {
  const today = new Date(2026, 0, 5, 12);
  const result: StatsQueryResult = {
    days: [{ day: '2026-01-05', activeMs: 60000, chars: 550 }],
    books: [
      {
        bookId: 'a',
        title: 'Alice',
        activeMs: 60000,
        chars: 550,
        charsPerMin: 550,
        lastReadAt: 1000,
        progress: 1,
        finished: true,
      },
    ],
    totals: { activeMs: 60000, chars: 550 },
  };
  expect(statsRange(today)).toEqual({ fromDay: '2025-12-07', toDay: '2026-01-05' });
  const model = statsModel(result, today);
  expect(model.days).toHaveLength(30);
  expect(model.days[0]).toEqual({ day: '2025-12-07', activeMs: 0, chars: 0 });
  expect(model.days[29]).toEqual(result.days[0]);
  expect(model.books[0]).toMatchObject({
    bookId: 'a',
    title: 'Alice',
    lastReadAt: '1970-01-01T00:00:01.000Z',
  });
  expect(model.booksFinished).toBe(1);
});
it('preserves missing last-read dates and an empty result', () => {
  const model = statsModel({ days: [], books: [], totals: { activeMs: 0, chars: 0 } });
  expect(model.days).toHaveLength(30);
  expect(model.books).toEqual([]);
});
