import type { CSSProperties } from 'react';
import type { ChromeColors } from '../reader/ReaderChrome.colors';
import styles from './AutoScrollPill.module.css';

export interface AutoScrollPillProps {
  active: boolean;
  paused: boolean;
  /** e.g. "120%" or "1.5×" — formatted by the caller. */
  speedLabel: string;
  /** Omit for the app's dark shell colours (UI-02, 2026-11-10: only the reading surface follows the preset). */
  colors?: Pick<ChromeColors, 'bg' | 'text1' | 'text2' | 'border'>;
}

/** Status pill shown while auto-scroll runs (AS-03). Speed-key hint appears on hover/focus. */
export function AutoScrollPill({ active, paused, speedLabel, colors }: AutoScrollPillProps) {
  const style = colors
    ? ({
        '--pill-bg': colors.bg,
        '--pill-text': colors.text1,
        '--pill-text2': colors.text2,
        '--pill-border': colors.border,
      } as CSSProperties)
    : undefined;
  return (
    <div
      className={styles.pill}
      style={style}
      data-active={active}
      data-paused={paused}
      role="status"
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>Auto-scroll</span>
      <span className={styles.speed}>{paused ? 'Paused' : speedLabel}</span>
      <span className={styles.hint}>
        {paused ? 'Space resume' : 'Space pause · - slower · = faster'}
      </span>
    </div>
  );
}
