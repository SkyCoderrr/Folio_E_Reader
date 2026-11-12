import { useId, useState } from 'react';
import { normalizeHex } from './colorValue';
import styles from './kit.module.css';

export interface ColorFieldProps {
  label: string;
  /** Normalised "#rrggbb". */
  value: string;
  onCommit: (value: string) => void;
}

/** Native picker commits live; typed hex validates on blur/Enter. */
export function ColorField({ label, value, onCommit }: ColorFieldProps) {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const n = normalizeHex(draft);
    if (n) {
      setInvalid(false);
      if (n !== value) onCommit(n);
      setDraft(null);
    } else setInvalid(true);
  };
  return (
    <div>
      <div className={styles.row}>
        <input
          type="color"
          className={styles.swatch}
          aria-label={`${label} picker`}
          value={value}
          onChange={(e) => {
            setDraft(null);
            setInvalid(false);
            onCommit(e.target.value);
          }}
        />
        <input
          className={styles.input}
          style={{ width: 104 }}
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          spellCheck={false}
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setInvalid(false)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(null);
              setInvalid(false);
            }
          }}
        />
      </div>
      {invalid ? (
        <p id={errorId} role="alert">
          Enter a valid hex colour (six digits).
        </p>
      ) : null}
    </div>
  );
}
