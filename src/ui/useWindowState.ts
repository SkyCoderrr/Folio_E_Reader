import { useEffect, useState } from 'react';
import type { WindowState } from '@contract/types';
import { invoke } from '../ipc/commands';
import { listen } from '../ipc/events';

/** window_get_state once, then follow window://state-changed. Null until known. */
export function useWindowState(): WindowState | null {
  const [state, setState] = useState<WindowState | null>(null);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen('window://state-changed', (s) => {
      if (!disposed) setState(s);
    })
      .then((un) => {
        if (disposed) un();
        else stop = un;
      })
      .catch(() => undefined);
    void invoke('window_get_state', {})
      .then((s) => {
        // an event may already have delivered something newer
        if (!disposed) setState((cur) => cur ?? s);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  return state;
}
