/**
 * PressArbiter (#12): consume the rest of one pointer press that has already been spoken for (it
 * closed a popover or panel), for exactly that press's lifetime: its mousedown default (selection,
 * focus) and its click (page turn, link) are cancelled, however long the press is held. The press
 * ends with its click, a pointercancel, or the next pointerdown; no timers.
 *
 * `target` is where the press happens: the host reading area, or a book iframe's window (a press
 * inside a book document never reaches the host document).
 */
export function consumePress(target: EventTarget): void {
  const stop = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const end = (): void => {
    target.removeEventListener('mousedown', stop, true);
    target.removeEventListener('click', onClick, true);
    target.removeEventListener('pointercancel', end, true);
    target.removeEventListener('pointerdown', end, true);
  };
  const onClick = (e: Event): void => {
    stop(e);
    end();
  };
  target.addEventListener('mousedown', stop, true);
  target.addEventListener('click', onClick, true);
  target.addEventListener('pointercancel', end, true);
  // A later press (the click never came: released elsewhere, dragged) starts fresh. Added while
  // this press's pointerdown is being dispatched, it only sees the next one.
  target.addEventListener('pointerdown', end, true);
}
