import { describe, expect, it } from 'vitest';
import type { BookRecord } from '@contract/types';
import {
  coverColor,
  filterBooks,
  formatLastRead,
  searchBooks,
  sortBooks,
  visibleBooks,
} from './libraryModel';

function book(o: Partial<BookRecord> & { id: string }): BookRecord {
  return {
    format: 'epub',
    title: o.id,
    author: null,
    language: null,
    fileName: o.id,
    filePath: o.id,
    fileSize: 1,
    fileMissing: false,
    coverPath: null,
    totalChars: null,
    progress: 0,
    addedAt: 0,
    lastOpenedAt: null,
    finishedAt: null,
    ...o,
  };
}
const ids = (bs: BookRecord[]) => bs.map((b) => b.id);

describe('sortBooks', () => {
  it('title uses numeric, case-insensitive collation', () => {
    const bs = [book({ id: 'b', title: 'Book 10' }), book({ id: 'a', title: 'book 2' })];
    expect(ids(sortBooks(bs, 'title', 'asc'))).toEqual(['a', 'b']);
    expect(ids(sortBooks(bs, 'title', 'desc'))).toEqual(['b', 'a']);
  });
  it('sorts Chinese titles by pinyin', () => {
    const bs = [
      book({ id: 'san', title: '三体' }),
      book({ id: 'hong', title: '红楼梦' }),
      book({ id: 'wei', title: '围城' }),
    ];
    expect(ids(sortBooks(bs, 'title', 'asc'))).toEqual(['hong', 'san', 'wei']);
  });
  it('lastRead puts never-opened books last in both directions', () => {
    const bs = [
      book({ id: 'never' }),
      book({ id: 'old', lastOpenedAt: 1 }),
      book({ id: 'new', lastOpenedAt: 9 }),
    ];
    expect(ids(sortBooks(bs, 'lastRead', 'desc'))).toEqual(['new', 'old', 'never']);
    expect(ids(sortBooks(bs, 'lastRead', 'asc'))).toEqual(['old', 'new', 'never']);
  });
  it('author puts missing authors last and does not mutate input', () => {
    const bs = [
      book({ id: 'x' }),
      book({ id: 'y', author: 'Zed' }),
      book({ id: 'z', author: 'Abe' }),
    ];
    expect(ids(sortBooks(bs, 'author', 'asc'))).toEqual(['z', 'y', 'x']);
    expect(ids(bs)).toEqual(['x', 'y', 'z']);
  });
});

describe('searchBooks / filterBooks', () => {
  const bs = [
    book({ id: 'a', title: '三体', author: '刘慈欣', progress: 0.4, format: 'txt' }),
    book({ id: 'b', title: 'Dune', author: 'Frank Herbert' }),
    book({ id: 'c', title: 'Emma', progress: 1, finishedAt: 5 }),
  ];
  it('matches title or author, case-insensitively', () => {
    expect(ids(searchBooks(bs, 'dUN'))).toEqual(['b']);
    expect(ids(searchBooks(bs, 'herbert'))).toEqual(['b']);
    expect(ids(searchBooks(bs, '刘'))).toEqual(['a']);
    expect(ids(searchBooks(bs, '  '))).toEqual(['a', 'b', 'c']);
  });
  it('filters by progress and format', () => {
    expect(ids(filterBooks(bs, 'reading', 'all'))).toEqual(['a']);
    expect(ids(filterBooks(bs, 'unread', 'all'))).toEqual(['b']);
    expect(ids(filterBooks(bs, 'finished', 'all'))).toEqual(['c']);
    expect(ids(filterBooks(bs, 'all', 'txt'))).toEqual(['a']);
    const v = visibleBooks(bs, {
      sort: 'title',
      sortDir: 'asc',
      filter: 'all',
      formatFilter: 'epub',
      query: 'e',
    });
    expect(ids(v)).toEqual(['b', 'c']);
  });
});

describe('formatLastRead / coverColor', () => {
  const now = 10 * 86_400_000;
  it('is relative up to 7 days', () => {
    expect(formatLastRead(null, now)).toBe('Never');
    expect(formatLastRead(now - 30_000, now)).toBe('Just now');
    expect(formatLastRead(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatLastRead(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatLastRead(now - 86_400_000, now)).toBe('Yesterday');
    expect(formatLastRead(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(formatLastRead(now - 9 * 86_400_000, now)).not.toMatch(/ago/);
  });
  it('cover colour is stable per id', () => {
    expect(coverColor('x')).toBe(coverColor('x'));
    expect(coverColor('x')).toMatch(/^hsl\(\d+ 55% 26%\)$/);
  });
});

import { sortClient } from './LibraryView';
it('sorts Format and Time left client-side, unknown time last', () => {
  const b = (id: string, format: string) => ({ id, format }) as never;
  const rows = [b('a', 'txt'), b('b', 'epub'), b('c', 'epub')];
  expect(sortClient(rows, 'format', 'asc').map((r: { id: string }) => r.id)).toEqual(['b', 'c', 'a']);
  expect(sortClient(rows, 'timeLeft', 'asc', { a: 5, c: 1 }).map((r: { id: string }) => r.id)).toEqual(['c', 'a', 'b']);
  expect(sortClient(rows, 'timeLeft', 'desc', { a: 5, c: 1 }).map((r: { id: string }) => r.id)).toEqual(['a', 'c', 'b']);
});
