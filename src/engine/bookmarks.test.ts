import { expect, it } from 'vitest';
import type { Bookmark } from '@contract/types';
import { sortBookmarks } from './bookmarks';

const bm = (id: string, sectionIndex: number, charOffset: number, createdAt: number) =>
  ({ id, createdAt, locator: { sectionIndex, charOffset } }) as unknown as Bookmark;

it('sorts bookmarks by book position, not creation time', () => {
  const rows = [bm('a', 2, 5, 1), bm('b', 0, 90, 3), bm('c', 0, 10, 2), bm('d', 2, 5, 0)];
  expect(sortBookmarks(rows).map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
  expect(rows[0]!.id).toBe('a');
});
