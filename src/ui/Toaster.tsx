import type { CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';

/** Sonner defaults for motion; themed with tokens. */
export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      style={
        {
          '--normal-bg': 'var(--surface-2)',
          '--normal-text': 'var(--text-1)',
          '--normal-border': 'var(--border-strong)',
          fontFamily: 'var(--font-ui)',
        } as CSSProperties
      }
    />
  );
}
