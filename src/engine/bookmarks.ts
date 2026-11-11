import type { Bookmark } from '@contract/types';
/** Reading order is independent of rounded progress and bookmark creation time. */
export function sortBookmarks(rows: readonly Bookmark[]): Bookmark[] {
  return [...rows].sort((a, b) => a.locator.sectionIndex - b.locator.sectionIndex ||
    a.locator.charOffset - b.locator.charOffset || a.createdAt - b.createdAt || a.id.localeCompare(b.id, 'en', { numeric: true }));
}
