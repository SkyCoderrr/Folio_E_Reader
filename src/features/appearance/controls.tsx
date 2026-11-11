import type { ReactNode } from 'react';
import { Slider } from '../../ui/kit';
import { resetStyle, setStyle, useOverridden, useStyleValue } from './styleHooks';
import kit from '../../ui/kit.module.css';
import styles from './appearance.module.css';

/** Labelled row with a reset dot that exists only while `path` is overridden. */
export function Field({
  label,
  path,
  children,
}: {
  label: string;
  path: string;
  children: ReactNode;
}) {
  const modified = useOverridden(path);
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <span className={kit.label}>{label}</span>
        <span className={kit.resetSlot}>
          {modified ? (
            <button
              type="button"
              className={kit.resetDot}
              aria-label={`Reset ${label}`}
              onClick={() => resetStyle(path)}
            />
          ) : null}
        </span>
      </div>
      {children}
    </div>
  );
}

interface NumProps {
  label: string;
  path: string;
  min: number;
  max: number;
  step: number;
}

/** Slider + numeric field bound to a style path; values are clamped before they reach the store. */
export function StyleSlider({ label, path, min, max, step }: NumProps) {
  const value = useStyleValue<number>(path);
  const modified = useOverridden(path);
  return (
    <Slider
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      modified={modified}
      onReset={() => resetStyle(path)}
      onChange={(v) => setStyle(path, Math.min(max, Math.max(min, v)))}
    />
  );
}
