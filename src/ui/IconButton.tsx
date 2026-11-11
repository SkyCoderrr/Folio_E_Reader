import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { ActionId } from '@contract/types';
import { Tooltip } from './Tooltip';
import { useShortcut } from './useShortcut';
import styles from './IconButton.module.css';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name and tooltip text. */
  label: string;
  /** Shortcut shown in the tooltip, e.g. "T". */
  shortcut?: string;
  /** Keymap action: the tooltip shows its current binding (wins over `shortcut`). */
  action?: ActionId;
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
}

/** 32 x 32 icon button with aria-label and a shortcut tooltip. */
export function IconButton({
  label,
  shortcut: fixed,
  action,
  align = 'center',
  children,
  ...rest
}: Props) {
  const live = useShortcut(action);
  const shortcut = live ?? fixed;
  return (
    <Tooltip label={label} shortcut={shortcut} align={align}>
      <button
        type="button"
        className={styles.btn}
        aria-label={label}
        aria-keyshortcuts={shortcut}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
