/** Whether an open/close was done from the keyboard (a key, or a click a key produced: detail 0). */
export function fromKeyboard(e: Event | undefined): boolean {
  if (!e) return false;
  if (e.type.startsWith('key')) return true;
  return e.type === 'click' && (e as MouseEvent).detail === 0;
}

export interface CloseFocusInput {
  /** Base UI's close interaction type ('keyboard', 'mouse', 'touch', 'pen', ''). */
  closeType: string;
  popup: HTMLElement | null;
  trigger: HTMLElement | null;
  openedByKeyboard: boolean;
  /** The reader's text, when the menu belongs to the reader. */
  home?: () => HTMLElement | null;
}

/**
 * Where focus goes when a menu or popover closes (Base UI `finalFocus`, read when the popup goes):
 *  - a command that moved focus elsewhere (Settings, a dialog, a panel field) keeps it;
 *  - opened and closed from the keyboard: back to the trigger, keyboard users keep their place (G0);
 *  - otherwise (a pointer was involved): `home` (the reader's text) when there is one, else the
 *    trigger, so the reading keys work at once and the chrome can hide again (#21).
 * No timers and no close-complete callback (#21, G-PM5).
 */
export function closeFocus({ closeType, popup, trigger, openedByKeyboard, home }: CloseFocusInput): boolean | HTMLElement {
  const active = document.activeElement;
  const ours = !active || active === document.body || active === trigger || !!popup?.contains(active);
  if (!ours) return false;
  if (openedByKeyboard && closeType === 'keyboard') return true;
  return home?.() ?? true;
}
