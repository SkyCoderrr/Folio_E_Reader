import type { ActionId, Keybindings } from '@contract/types';
import { subscribeReadingPause } from './pauseBus';
import { isForwardedEvent } from '../renderers/FlowRenderer';
import { effectiveKeymap, eventChord, inScope, SCOPE_PRIORITY, type Scope } from './keymap';

export function isEditing(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
  );
}
/** Value controls: they take typing or arrows and keep focus after a pointer press. */
const ENTRY =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="option"], [role="combobox"], [role="radiogroup"], [role="radio"]';
/** Navigation controls: they move with arrows/Home/End themselves (menus, tabs, the TOC tree). */
const NAVIGATION =
  '[role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tablist"], [role="tab"], [role="tree"], [role="treeitem"], [role="grid"]';
/** Plain activators: Space/Enter press them; every other key is still the reader's. */
const ACTIVATOR = 'button, a[href], summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"]';

/**
 * What a focused element does with keys (G0):
 *  - 'entry' / 'navigation': it uses the reading keys itself, so they are not the reader's;
 *  - 'activator': only Space and Enter are its (they press it);
 *  - null: nothing focused that wants keys (the text, the page, a plain panel area).
 */
export type KeyOwner = 'entry' | 'navigation' | 'activator' | null;
export function keyOwner(target: EventTarget | null): KeyOwner {
  const el = target as Element | null;
  if (!el?.closest) return null;
  if (el.closest(ENTRY)) return 'entry';
  if (el.closest(NAVIGATION)) return 'navigation';
  if (el.closest(ACTIVATOR)) return 'activator';
  return null;
}
/** Keys that press a focused button or link. */
export function isActivationKey(e: KeyboardEvent): boolean {
  return e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
}
export interface RouterOptions {
  /** Active scopes for this key event (the target tells whether focus is on a control). */
  scopes(event: KeyboardEvent): Scope[];
  bindings?: Keybindings | (() => Keybindings);
  handle(action: ActionId, phase: 'down' | 'up', event: KeyboardEvent): boolean;
  /** Stop held motion on hidden documents / genuine focus loss, never iframe focus. */
  stop?(): void;
}
export function installKeyRouter(target: Window, options: RouterOptions): () => void {
  const held = new Map<string, ActionId>();
  const reset = () => {
    held.clear();
    options.stop?.();
  };
  const route = (e: KeyboardEvent) => {
    if (e.type === 'keyup') {
      const action = held.get(e.code);
      if (action) {
        held.delete(e.code);
        options.handle(action, 'up', e);
        e.preventDefault();
      }
      return;
    }
    // One physical press, including duplicate forwarded/original events without repeat=true.
    // A stray OS repeat after a focus reset must not start a new held movement either.
    if (held.has(e.code) || e.repeat) {
      if (held.has(e.code)) e.preventDefault();
      return;
    }
    if (
      e.defaultPrevented ||
      e.isComposing ||
      e.key === 'Process' ||
      e.keyCode === 229 ||
      e.metaKey
    )
      return;
    // Forwarded clones are deliberately untrusted and originate from the renderer mount.
    if (!isForwardedEvent(e) && isEditing(e.target)) return;
    const chord = eventChord(e);
    const map = effectiveKeymap(
      typeof options.bindings === 'function' ? options.bindings() : options.bindings,
    );
    const active = options.scopes(e);
    for (const scope of SCOPE_PRIORITY.filter((s) => active.includes(s))) {
      for (const [action, chords] of Object.entries(map) as [ActionId, string[]][]) {
        if (!inScope(action, scope) || !chords.includes(chord)) continue;
        if (options.handle(action, 'down', e)) {
          held.set(e.code, action);
          e.preventDefault();
          return;
        }
      }
    }
  };
  const visibility = () => {
    if (target.document.hidden) reset();
  };
  const blur = () => {
    if (!target.document.hasFocus()) reset();
  };
  const stopPause = subscribeReadingPause(reset);
  target.addEventListener('keydown', route);
  target.addEventListener('keyup', route);
  target.addEventListener('blur', blur);
  target.document.addEventListener('visibilitychange', visibility);
  return () => {
    stopPause();
    reset();
    target.removeEventListener('keydown', route);
    target.removeEventListener('keyup', route);
    target.removeEventListener('blur', blur);
    target.document.removeEventListener('visibilitychange', visibility);
  };
}
