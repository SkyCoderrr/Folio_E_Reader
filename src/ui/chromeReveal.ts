/** Reader chrome reachability rules (PRD 6.8) as pure helpers. */

/** Moving the pointer into the top 56 px reveals the top bar. */
export const REVEAL_ZONE_PX = 56;
/** Reveal must complete within 100 ms (also the show fade duration). */
export const REVEAL_MS = 100;
/** Hide fade duration. */
export const HIDE_FADE_MS = 150;
/** How long the pointer may be away before the chrome starts hiding. */
export const HIDE_GRACE_MS = 2000;

export interface ChromeInputs {
  /** `H` pin. */
  pinned: boolean;
  /** Pointer is inside the top reveal zone. */
  pointerInZone: boolean;
  /** Pointer is over the bar or footer. */
  hovering: boolean;
  /** One of the bar's menus/popovers is open. */
  menuOpen: boolean;
  /** Keyboard focus is inside the chrome. */
  focusWithin: boolean;
}

export function inRevealZone(clientY: number): boolean {
  return Number.isFinite(clientY) && clientY >= 0 && clientY <= REVEAL_ZONE_PX;
}

export function chromeWantsVisible(i: ChromeInputs): boolean {
  return i.pinned || i.pointerInZone || i.hovering || i.menuOpen || i.focusWithin;
}

/** Fade time for the transition into `show`. */
export function fadeMs(show: boolean): number {
  return show ? REVEAL_MS : HIDE_FADE_MS;
}
