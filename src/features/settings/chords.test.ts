import { expect, it } from 'vitest';
import {
  chordFromEvent,
  findConflict,
  formatChord,
  isReserved,
  normalizeChord,
  validateBossChord,
} from './chords';

const ev = (code: string, m: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...m,
});

it('builds chords from events in Windows order and ignores bare modifiers', () => {
  expect(chordFromEvent(ev('KeyB', { altKey: true, ctrlKey: true }))).toBe('Ctrl+Alt+B');
  expect(chordFromEvent(ev('Equal', { ctrlKey: true }))).toBe('Ctrl+Equal');
  expect(chordFromEvent(ev('Digit1', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+1');
  expect(chordFromEvent(ev('ControlLeft', { ctrlKey: true }))).toBeNull();
});

it('formats for display and normalizes order', () => {
  expect(formatChord('Ctrl+Equal')).toBe('Ctrl+=');
  expect(formatChord('PageDown')).toBe('PgDn');
  expect(normalizeChord('Shift+Ctrl+Space')).toBe('Ctrl+Shift+Space');
});

it('rejects reserved chords', () => {
  expect(isReserved('Alt+F4')).toBe(true);
  expect(isReserved('Alt+Tab')).toBe(true);
  expect(isReserved('Ctrl+Alt+Delete')).toBe(true);
  expect(isReserved('Win+L')).toBe(true);
  expect(isReserved('Ctrl+F4')).toBe(false);
});

it('applies the boss-key rule', () => {
  expect(validateBossChord('B')).toEqual({ ok: false, reason: 'needsModifier' });
  expect(validateBossChord('F5')).toEqual({ ok: false, reason: 'needsModifier' });
  expect(validateBossChord('Alt+F4')).toEqual({ ok: false, reason: 'reserved' });
  expect(validateBossChord('Ctrl+Alt+B').ok).toBe(true);
  expect(validateBossChord('Pause').ok).toBe(true);
  expect(validateBossChord('ScrollLock').ok).toBe(true);
  expect(validateBossChord('F13').ok).toBe(true);
  expect(validateBossChord('F24').ok).toBe(true);
  expect(validateBossChord('F25').ok).toBe(false);
});

it('detects conflicts only inside one scope', () => {
  const rows = [
    { actionId: 'page.next', scope: 'reader', chords: ['Space'] },
    { actionId: 'toc.toggle', scope: 'reader', chords: ['T'] },
    { actionId: 'autoscroll.pause', scope: 'reader.autoscroll', chords: ['Space'] },
  ];
  expect(findConflict(rows, 'toc.toggle', 'Space')?.actionId).toBe('page.next');
  expect(findConflict(rows, 'autoscroll.pause', 'Space')).toBeNull();
  expect(findConflict(rows, 'toc.toggle', 'T')).toBeNull();
});
