import type { ReactNode } from 'react';
import { Slider } from '../../ui/kit';
import styles from './settings.module.css';

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      {title ? <h3 className={styles.groupTitle}>{title}</h3> : null}
      {children}
    </section>
  );
}

/** A labelled control row: text on the left, control on the right. */
export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowTitle}>{title}</div>
        {hint ? <div className={styles.rowHint}>{hint}</div> : null}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

export interface NumSettingProps {
  label: string;
  unit: string;
  value: number;
  /** Default from settings.defaults.json; the reset dot shows when value differs. */
  def: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onChange: (v: number) => void;
  /** Reset to default (patch value null). */
  onReset: () => void;
}

/** Slider + number field with the unit in the label. Range comes from PRD 8.2-8.5. */
export function NumSetting({ label, unit, hint, def, value, onReset, ...rest }: NumSettingProps) {
  return (
    <div className={styles.numRow}>
      <Slider
        label={`${label} (${unit})`}
        value={value}
        modified={value !== def}
        onReset={onReset}
        {...rest}
      />
      {hint ? <div className={styles.rowHint}>{hint}</div> : null}
    </div>
  );
}
