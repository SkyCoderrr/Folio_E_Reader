import { useSyncExternalStore } from 'react';
import type { WindowState } from '@contract/types';
import { invoke } from '../ipc/commands';
import { listen } from '../ipc/events';

/**
 * The one window-state store (#23): window_get_state once, then window://state-changed, shared by
 * every subscriber (ReaderView, TitleBar, the reader session). Null until known. The IPC
 * subscription lives while anyone listens.
 */
let state: WindowState | null = null;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

const publish = (next: WindowState) => {
  state = next;
  listeners.forEach((fn) => fn());
};

function connect(): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen('window://state-changed', (s) => {
    if (!disposed) publish(s);
  })
    .then((un) => {
      if (disposed) un();
      else unlisten = un;
    })
    .catch(() => undefined);
  void invoke('window_get_state', {})
    .then((s) => {
      // an event may already have delivered something newer
      if (!disposed && state === null) publish(s);
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export const windowState = {
  get: (): WindowState | null => state,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    stop ??= connect();
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0) {
        stop?.();
        stop = null;
        state = null;
      }
    };
  },
};

export function useWindowState(): WindowState | null {
  return useSyncExternalStore(windowState.subscribe, windowState.get, () => null);
}
