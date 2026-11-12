import { useCallback } from 'react';
import type { ActionId, Keybindings } from '@contract/types';
import { effectiveKeymap } from '../engine/input/keymap';
import { formatChord } from '../features/settings/chords';
import { useSettings } from '../state/settingsStore';

/** Display text of an action's first current binding (rebinding-aware), or undefined if unbound. */
export function shortcutFor(action: ActionId, overrides: Keybindings = {}): string | undefined {
  const chords = (effectiveKeymap(overrides) as Partial<Record<string, string[]>>)[action];
  return chords && chords.length > 0 && chords[0] ? formatChord(chords[0]) : undefined;
}

/** KB-01.2: live shortcut label for tooltips and menu items. */
export function useShortcut(action: ActionId | undefined): string | undefined {
  const overrides = useSettings((s) => s.settings.keybindings);
  return action ? shortcutFor(action, overrides) : undefined;
}

/** Same, for building many menu entries at once: `const sc = useShortcuts(); sc('toc.toggle')`. */
export function useShortcuts(): (action: ActionId) => string | undefined {
  const overrides = useSettings((s) => s.settings.keybindings);
  return useCallback((action: ActionId) => shortcutFor(action, overrides), [overrides]);
}
