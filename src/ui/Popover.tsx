import type { ReactElement, ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import styles from './kit.module.css';

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** false = do not return focus to the trigger on close (the caller hands it elsewhere). */
  restoreFocus?: boolean;
}

/** Grows from the trigger: 150 ms scale 0.97 -> 1 + opacity (PRD 6.6). */
export function Popover({ trigger, children, label, open, onOpenChange, restoreFocus = true }: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className={styles.positioner} sideOffset={8}>
          <BasePopover.Popup
            className={styles.popup}
            aria-label={label}
            finalFocus={restoreFocus}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
