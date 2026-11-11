import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import styles from './kit.module.css';

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** Single-select toggle group; selection can't be cleared. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => v[0] !== undefined && onChange(v[0] as T)}
      className={styles.segmented}
    >
      {options.map((o) => (
        <Toggle key={o.value} value={o.value} className={styles.seg}>
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
