/** Title-bar mouse semantics (contract: window_start_drag UI note). */
export type DragAction = 'drag' | 'toggle-maximize' | null;

export function dragAction(e: { button: number; detail: number }): DragAction {
  if (e.button !== 0) return null;
  return e.detail === 2 ? 'toggle-maximize' : e.detail === 1 ? 'drag' : null;
}

/** Controls inside the bar never start a drag. */
export const NO_DRAG_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [data-no-drag]';
