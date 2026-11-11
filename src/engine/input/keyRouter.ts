import type { ActionId, Keybindings } from '@contract/types';
import { subscribeReadingPause } from './pauseBus';
import { isForwardedEvent } from '../renderers/FlowRenderer';
import { actionScope, effectiveKeymap, eventChord, SCOPE_PRIORITY, type Scope } from './keymap';

export function isEditing(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
  );
}
export interface RouterOptions {
  scopes(): Scope[];
  bindings?: Keybindings | (() => Keybindings);
  /** Panels can shadow reader chords without changing the stored action bindings. */
  scopedBindings?: Partial<Record<Scope, Partial<Record<ActionId, string[]>>>>;
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
    for (const scope of SCOPE_PRIORITY.filter((s) => options.scopes().includes(s))) {
      const scoped = {
        ...Object.fromEntries(
          Object.entries(map).filter(([action]) => actionScope(action as ActionId) === scope),
        ),
        ...options.scopedBindings?.[scope],
      };
      for (const [action, chords] of Object.entries(scoped) as [ActionId, string[]][]) {
        if (!chords.includes(chord)) continue;
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
