import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronsUpDown } from 'lucide-react';
import styles from './kit.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}
export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}

export function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => v !== null && onChange(v as T)}
      items={options}
    >
      <BaseSelect.Trigger className={styles.selectTrigger} aria-label={label}>
        <BaseSelect.Value />
        <BaseSelect.Icon>
          <ChevronsUpDown size={16} strokeWidth={1.5} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className={styles.positioner}
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className={styles.popup}>
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item key={o.value} value={o.value} className={styles.item}>
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className={styles.shortcut}>
                    <Check size={16} strokeWidth={1.5} aria-hidden />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
