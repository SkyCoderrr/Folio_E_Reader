/**
 * Re-dispatch key and Ctrl+wheel events from section iframes to the app (PRD §10.4 step 7, KB-01),
 * so the key router works while focus is inside book content. Clones bubble from the target
 * (default: the renderer's mount element) up to document and window; they are untrusted
 * (`isTrusted === false`), so the router must accept them, and can recognise them with
 * `isForwardedEvent`. If the app cancels the clone, the original is cancelled too, which stops
 * Chromium's default action (e.g. keyboard scrolling chaining to the parent scroller).
 */

const forwarded = new WeakSet<Event>();

/** True for clones that FlowRenderer forwarded out of a section iframe. */
export const isForwardedEvent = (e: Event): boolean => forwarded.has(e);

export function forwardKey(e: KeyboardEvent, target: EventTarget): void {
  // The clone targets the renderer mount, so preserve the original editing/IME guard here.
  // Always forward releases: focus may have moved into a field while an arrow was held.
  const origin = e.target as Element | null;
  if (
    e.type === 'keydown' &&
    (e.defaultPrevented ||
      e.keyCode === 229 ||
      origin?.closest?.(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      ))
  )
    return;
  const clone = new KeyboardEvent(e.type, {
    key: e.key,
    code: e.code,
    location: e.location,
    repeat: e.repeat,
    isComposing: e.isComposing, // the router ignores IME composition (KB-01)
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  forwarded.add(clone);
  if (!target.dispatchEvent(clone) && e.cancelable) e.preventDefault();
}

/**
 * Only Ctrl+wheel is forwarded (font size, KB-07). The iframe listener is passive so plain wheel
 * scrolling stays on the compositor and chains natively to the parent scroller; WebView zoom is
 * disabled at the WebView2 level, so the original Ctrl+wheel needs no preventDefault.
 */
export function forwardCtrlWheel(e: WheelEvent, target: EventTarget): void {
  if (!e.ctrlKey) return;
  const clone = new WheelEvent(e.type, {
    deltaX: e.deltaX,
    deltaY: e.deltaY,
    deltaZ: e.deltaZ,
    deltaMode: e.deltaMode,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  forwarded.add(clone);
  target.dispatchEvent(clone);
}
