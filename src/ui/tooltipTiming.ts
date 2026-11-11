/** Tooltip timing (PRD 6.6): 500 ms delay, adjacent tooltips open instantly. */
export const TOOLTIP_DELAY_MS = 500;
/** A tooltip opened within this window of the previous one closing is "adjacent". */
export const TOOLTIP_ADJACENT_MS = 300;

export function tooltipDelay(now: number, lastClosedAt: number | null): number {
  return lastClosedAt !== null && now - lastClosedAt < TOOLTIP_ADJACENT_MS ? 0 : TOOLTIP_DELAY_MS;
}

const clock: { lastClosedAt: number | null } = { lastClosedAt: null };

export function currentTooltipDelay(now = Date.now()): number {
  return tooltipDelay(now, clock.lastClosedAt);
}

export function noteTooltipClosed(now = Date.now()): void {
  clock.lastClosedAt = now;
}
