import { NumberField as BaseNumber } from '@base-ui/react/number-field';
import clsx from 'clsx';
import styles from './kit.module.css';

export interface NumberFieldProps {
  value: number | null;
  /** Fires on commit only (blur / Enter / step), already clamped by min/max. */
  onCommit: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  'aria-label': string;
  className?: string;
}

/** Numeric input; validation happens on commit, never per keystroke. */
export function NumberField({
  onCommit,
  className,
  'aria-label': label,
  ...rest
}: NumberFieldProps) {
  return (
    <BaseNumber.Root
      {...rest}
      onValueCommitted={(v) => onCommit(v)}
      className={clsx(styles.numGroup, className)}
    >
      <BaseNumber.Group style={{ width: '100%' }}>
        <BaseNumber.Input aria-label={label} className={styles.input} />
      </BaseNumber.Group>
    </BaseNumber.Root>
  );
}
