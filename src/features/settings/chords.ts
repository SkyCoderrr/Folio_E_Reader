import { layoutKey } from '../../engine/input/keyboardLayout';
import { eventChord } from '../../engine/input/keymap';

/**
 * Chord helpers for Settings. Grammar is the keymap's: `Ctrl+Alt+Shift+<code>` where the code is
 * KeyboardEvent.code with `Key`/`Digit` prefixes stripped (`Ctrl+Equal`, `Shift+Space`, `B`).
 * `Win+` is accepted only so it can be recognised and rejected as reserved.
 */
export const MAX_CHORDS_PER_ACTION = 3;

export interface ParsedChord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  win: boolean;
  key: string;
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
  'OS',
]);

export function parseChord(chord: string): ParsedChord {
  const parts = chord.split('+');
  // A trailing "+" key would split into an empty last part; keys are code names so it never occurs.
  const key = parts[parts.length - 1] ?? '';
  const mods = new Set(parts.slice(0, -1));
  return {
    ctrl: mods.has('Ctrl'),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
    win: mods.has('Win'),
    key,
  };
}

/** Canonical order: Ctrl+Alt+Shift+Win+Key. */
export function normalizeChord(chord: string): string {
  const p = parseChord(chord);
  return `${p.ctrl ? 'Ctrl+' : ''}${p.alt ? 'Alt+' : ''}${p.shift ? 'Shift+' : ''}${p.win ? 'Win+' : ''}${p.key}`;
}

/** Chord of a keydown, or null for a bare modifier press (keep waiting). */
export function chordFromEvent(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string | null {
  if (!e.code || e.code === 'Unidentified' || MODIFIER_CODES.has(e.code)) return null;
  return normalizeChord(`${e.metaKey ? 'Win+' : ''}${eventChord(e as KeyboardEvent)}`);
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Escape: 'Esc',
  Delete: 'Del',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  ScrollLock: 'Scroll Lock',
};

export function formatKey(key: string): string {
  return layoutKey(key) ?? KEY_LABELS[key] ?? key.replace(/^Numpad(.+)$/, 'Num $1');
}

/** Display text in Windows order, e.g. `Ctrl+Alt+B`, `Ctrl+=`. */
export function formatChord(chord: string): string {
  const p = parseChord(normalizeChord(chord));
  return `${p.ctrl ? 'Ctrl+' : ''}${p.alt ? 'Alt+' : ''}${p.shift ? 'Shift+' : ''}${p.win ? 'Win+' : ''}${formatKey(p.key)}`;
}

/** Chords the OS or the app owns (PRD 7). */
export function isReserved(chord: string, debugBuild = import.meta.env.DEV): boolean {
  const p = parseChord(chord);
  if (p.win || (debugBuild && p.key === 'F12')) return true;
  if (p.alt && !p.ctrl && !p.shift && (p.key === 'F4' || p.key === 'Tab')) return true;
  if (p.ctrl && p.alt && p.key === 'Delete') return true;
  return false;
}

const BARE_OK = /^(Pause|ScrollLock|F(1[3-9]|2[0-4]))$/;

export type BossRuleError = 'reserved' | 'needsModifier';

/** Boss key must include a modifier, or be Pause / ScrollLock / F13-F24 (PRD 7). */
export function validateBossChord(
  chord: string,
  debugBuild = import.meta.env.DEV,
): { ok: true } | { ok: false; reason: BossRuleError } {
  if (isReserved(chord, debugBuild)) return { ok: false, reason: 'reserved' };
  const p = parseChord(chord);
  if (p.ctrl || p.alt || p.shift || p.win || BARE_OK.test(p.key)) return { ok: true };
  return { ok: false, reason: 'needsModifier' };
}

export interface KeymapRow {
  actionId: string;
  label: string;
  scope: string;
  chords: string[];
  defaults: string[];
}

/** Another action in the same scope already using `chord`, or null. */
export function findConflict<T extends Pick<KeymapRow, 'actionId' | 'scope' | 'chords'>>(
  rows: readonly T[],
  actionId: string,
  chord: string,
): T | null {
  const me = rows.find((r) => r.actionId === actionId);
  if (!me) return null;
  const c = normalizeChord(chord);
  return (
    rows.find(
      (r) =>
        r.actionId !== actionId &&
        (r.scope === me.scope || r.scope === 'app' || me.scope === 'app') &&
        r.chords.some((x) => normalizeChord(x) === c),
    ) ?? null
  );
}

export function sameChords(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length && a.every((c, i) => normalizeChord(c) === normalizeChord(b[i] ?? ''))
  );
}
