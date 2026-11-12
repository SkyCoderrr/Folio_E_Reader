import { useCallback, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { useOverlay } from '../state/overlayStore';
import { closeFocus, fromKeyboard } from './closeFocus';
import styles from './kit.module.css';

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where a pointer close sends focus (the reader's text); default the trigger. See closeFocus. */
  focusHome?: () => HTMLElement | null;
}

/** Grows from the trigger: 150 ms scale 0.97 -> 1 + opacity (PRD 6.6). A modal overlay while open (#13). */
export function Popover({
  trigger,
  children,
  label,
  open,
  onOpenChange,
  focusHome,
}: PopoverProps) {
  const [inner, setInner] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedByKeyboard = useRef(false);
  const finalFocus = useCallback(
    (closeType: string) =>
      closeFocus({
        closeType,
        popup: popup.current,
        trigger: triggerRef.current,
        openedByKeyboard: openedByKeyboard.current,
        home: focusHome,
      }),
    [focusHome],
  );
  useOverlay(useId(), 'modal', open ?? inner);
  return (
    <BasePopover.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) openedByKeyboard.current = fromKeyboard(details.event);
        setInner(next);
        onOpenChange?.(next);
      }}
    >
      <BasePopover.Trigger ref={triggerRef} render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className={styles.positioner} sideOffset={8}>
          <BasePopover.Popup
            ref={popup}
            className={styles.popup}
            aria-label={label}
            finalFocus={finalFocus}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
