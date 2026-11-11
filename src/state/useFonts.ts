import { useEffect } from 'react';
import { create } from 'zustand';
import type { FontFamily } from '@contract/types';
import { invoke } from '../ipc/commands';
const cache = create<{ fonts: FontFamily[] | null }>(() => ({ fonts: null }));
let requested = false;
export function useFonts(): { fonts: FontFamily[] | null } {
  const state = cache();
  useEffect(() => {
    if (requested) return;
    requested = true;
    const load = () => {
      void invoke('fonts_list', {})
        .then((fonts) => cache.setState({ fonts }))
        .catch(console.warn);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(load);
    else setTimeout(load, 0);
  }, []);
  return state;
}
