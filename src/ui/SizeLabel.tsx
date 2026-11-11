import { useEffect, useState } from 'react';
import styles from './SizeLabel.module.css';

export const SIZE_LABEL_MS = 1000;

interface Props {
  /** Current font size in px; null/undefined until the first change. */
  px?: number | null;
  /** Changes on every size change (even to the same value) to restart the 1 s window. */
  stamp?: number;
  /** Visible duration. Default 1000 ms (KB-07.3). */
  durationMs?: number;
}

/** KB-07.3: "20 px" near the top centre for 1 s after Ctrl+= / Ctrl+- / Ctrl+0. Opacity only. */
export function SizeLabel({ px, stamp = 0, durationMs = SIZE_LABEL_MS }: Props) {
  const [shown, setShown] = useState<{ stamp: number } | null>(null);
  const [prev, setPrev] = useState<{ px: number | null | undefined; stamp: number } | null>(null);
  if (px != null && (prev?.px !== px || prev?.stamp !== stamp)) {
    setPrev({ px, stamp });
    setShown({ stamp });
  }
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), durationMs);
    return () => window.clearTimeout(t);
  }, [shown, durationMs]);
  return (
    <div className={styles.label} data-visible={shown !== null} aria-live="polite">
      {px != null ? `${px} px` : ''}
    </div>
  );
}
