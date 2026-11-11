import { useState } from 'react';
import { normalizeHex } from './colorValue';
import styles from './kit.module.css';

export interface ColorFieldProps {
  label: string;
  /** Normalised "#rrggbb". */
  value: string;
  onCommit: (value: string) => void;
}

/** Swatch + hex input. Validates on commit (blur/Enter) only; invalid input reverts. */
export function ColorField({ label, value, onCommit }: ColorFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const n = normalizeHex(draft);
    if (n) {
      setInvalid(false);
      if (n !== value) onCommit(n);
    } else setInvalid(true);
    setDraft(null);
  };
  return (
    <div className={styles.row}>
      <span className={styles.swatch} style={{ background: value }} aria-hidden />
      <input
        className={styles.input}
        style={{ width: 104 }}
        aria-label={label}
        aria-invalid={invalid}
        spellCheck={false}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setInvalid(false)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </div>
  );
}
