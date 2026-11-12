import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * What is open on top of the current screen (#13). One owner for Escape and for the key-router
 * scopes; no DOM queries, no observers.
 *  - 'modal': a Base UI menu, popover or dialog. It owns Escape and the keyboard while open; app
 *    and reader shortcuts are off (Escape closes only the modal).
 *  - 'panel': a non-modal reader side panel (Contents/Bookmarks, Appearance). Escape closes the top
 *    one. Reading keys keep working while focus is not inside it (G0: where focus is decides).
 *  - 'screen': a full-window screen over the app (Settings). Escape closes it.
 */
export type OverlayKind = 'modal' | 'panel' | 'screen';

export interface Overlay {
  id: string;
  kind: OverlayKind;
  /** Closes it (Escape). Modals close themselves and pass none. */
  close?: () => void;
}

let stack: readonly Overlay[] = [];
const listeners = new Set<() => void>();
const publish = (next: readonly Overlay[]) => {
  stack = next;
  listeners.forEach((fn) => fn());
};

export const overlays = {
  /** Opens (or re-opens on top) an overlay. */
  open(overlay: Overlay): void {
    publish([...stack.filter((o) => o.id !== overlay.id), overlay]);
  },
  close(id: string): void {
    if (stack.some((o) => o.id === id)) publish(stack.filter((o) => o.id !== id));
  },
  top(): Overlay | undefined {
    return stack[stack.length - 1];
  },
  any(): boolean {
    return stack.length > 0;
  },
  has(kind: OverlayKind): boolean {
    return stack.some((o) => o.kind === kind);
  },
  /** A modal or a screen is open: it owns the keyboard and covers the reading (not a panel). */
  covering(): boolean {
    return stack.some((o) => o.kind !== 'panel');
  },
  /**
   * Escape: closes the top panel or screen and returns true. A modal on top closes itself
   * (returns true: Escape is spoken for); false = nothing is open.
   */
  dismissTop(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    if (top.kind !== 'modal') {
      publish(stack.slice(0, -1));
      top.close?.();
    }
    return true;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  snapshot(): readonly Overlay[] {
    return stack;
  },
  /** Tests. */
  reset(): void {
    publish([]);
  },
};

/** Registers an overlay while `open` is true; `close` may change between renders. */
export function useOverlay(id: string, kind: OverlayKind, open: boolean, close?: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    overlays.open({ id, kind, close: close ? () => closeRef.current?.() : undefined });
    return () => overlays.close(id);
  }, [id, kind, open]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useOverlays(): readonly Overlay[] {
  return useSyncExternalStore(overlays.subscribe, overlays.snapshot);
}
