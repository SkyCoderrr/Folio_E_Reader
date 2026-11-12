import type { ActionId, Keybindings } from '@contract/types';

export type Scope = 'panel' | 'reader.autoscroll' | 'reader' | 'library' | 'app' | 'global';
export const SCOPE_PRIORITY: Scope[] = [
  'panel',
  'reader.autoscroll',
  'reader',
  'library',
  'app',
  'global',
];
export const DEFAULT_KEYMAP: Partial<Record<ActionId, string[]>> = {
  'scroll.down': ['ArrowDown'],
  'scroll.up': ['ArrowUp'],
  'page.next': ['PageDown', 'Space', 'ArrowRight'],
  'page.prev': ['PageUp', 'Shift+Space', 'ArrowLeft'],
  'chapter.start': ['Home'],
  'chapter.end': ['End'],
  'book.start': ['Ctrl+Home'],
  'book.end': ['Ctrl+End'],
  'toc.toggle': ['T'],
  'bookmarks.show': ['Ctrl+B'],
  'bookmark.toggle': ['Ctrl+D'],
  'appearance.toggle': ['A'],
  'chrome.toggle': ['H'],
  'fullscreen.toggle': ['F11'],
  'font.increase': ['Ctrl+Equal', 'Ctrl+NumpadAdd'],
  'font.decrease': ['Ctrl+Minus'],
  'font.reset': ['Ctrl+0'],
  'layout.toggleFlow': ['M'],
  'layout.togglePages': ['D'],
  'autoscroll.toggle': ['S'],
  'book.close': ['Ctrl+W'],
  dismiss: ['Escape'],
  'autoscroll.pause': ['Space'],
  'autoscroll.faster': ['Equal'],
  'autoscroll.slower': ['Minus'],
  'library.import': ['Ctrl+O'],
  'library.search': ['Ctrl+F'],
  'library.viewGrid': ['Ctrl+1'],
  'library.viewList': ['Ctrl+2'],
  'library.open': ['Enter'],
  'library.remove': ['Delete'],
  'library.selectAll': ['Ctrl+A'],
  'settings.open': ['Ctrl+Comma'],
  'app.quit': ['Ctrl+Q'],
};
/**
 * Reader actions that stay live while a panel is open or focus is on a control (the 'panel' scope):
 * they change the chrome or mark the place, never move the reading position, and never use
 * Space/Enter/arrows.
 */
export const CHROME_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>([
  'dismiss',
  'bookmark.toggle',
  'toc.toggle',
  'bookmarks.show',
  'appearance.toggle',
  'chrome.toggle',
  'fullscreen.toggle',
  'font.increase',
  'font.decrease',
  'font.reset',
  'book.close',
]);
/** Whether `action` is routed in `scope` ('panel' carries the chrome subset of the reader). */
export function inScope(action: ActionId, scope: Scope): boolean {
  return scope === 'panel' ? CHROME_ACTIONS.has(action) : actionScope(action) === scope;
}
export function actionScope(action: ActionId): Scope {
  if (['autoscroll.pause', 'autoscroll.faster', 'autoscroll.slower'].includes(action))
    return 'reader.autoscroll';
  if (action.startsWith('library.')) return 'library';
  if (action === 'settings.open' || action === 'app.quit') return 'app';
  return 'reader';
}
export function eventChord(e: KeyboardEvent): string {
  const code = e.code.replace(/^Key([A-Z])$/, '$1').replace(/^Digit([0-9])$/, '$1');
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${code}`;
}
export function effectiveKeymap(overrides: Keybindings = {}) {
  // Ignore retired actions in older saved settings after the contract 0.2.1 removal.
  return Object.fromEntries(
    Object.entries({ ...DEFAULT_KEYMAP, ...overrides }).filter(
      ([action]) => action !== 'chapter.next' && action !== 'chapter.prev',
    ),
  );
}
