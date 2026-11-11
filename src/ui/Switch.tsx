import { Switch as BaseSwitch } from '@base-ui/react/switch';
import styles from './kit.module.css';

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <label className={styles.checkRow}>
      <span>{label}</span>
      <BaseSwitch.Root checked={checked} onCheckedChange={onChange} className={styles.switch}>
        <BaseSwitch.Thumb className={styles.switchThumb} />
      </BaseSwitch.Root>
    </label>
  );
}
