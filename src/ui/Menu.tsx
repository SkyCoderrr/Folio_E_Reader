import { useCallback, useId, useRef, useState, type ReactElement } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import clsx from 'clsx';
import { useOverlay } from '../state/overlayStore';
import { closeFocus, fromKeyboard } from './closeFocus';
import styles from './kit.module.css';

export type MenuEntry =
  | { type?: 'item'; label: string; shortcut?: string; danger?: boolean; onSelect: () => void }
  | { type: 'separator' };

/**
 * Command menu. A modal overlay while open (#13: it owns the keyboard and Escape). It closes
 * instantly (no exit fade, fb4/G-PM5) and a selected command runs as part of that close (in
 * onOpenChange(false), the same update), so a command that swaps the screen (Settings, Back to
 * Library) appears in the frame the menu goes, never under a fading menu, and runs once even when
 * Base UI re-dispatches the click (drag-release). Focus on close: see closeFocus.
 */
export function Menu({
  trigger,
  items,
  onOpenChange,
  focusHome,
}: {
  trigger: ReactElement;
  items: MenuEntry[];
  onOpenChange?: (open: boolean) => void;
  /** Where a pointer close sends focus (the reader's text); default the trigger. */
  focusHome?: () => HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
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
  const selected = useRef<(() => void) | null>(null);
  useOverlay(useId(), 'modal', open);
  return (
    <BaseMenu.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) openedByKeyboard.current = fromKeyboard(details.event);
        const run = next ? null : selected.current;
        selected.current = null;
        setOpen(next);
        onOpenChange?.(next);
        run?.();
      }}
    >
      <BaseMenu.Trigger ref={triggerRef} render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles.positioner} sideOffset={4}>
          <BaseMenu.Popup
            ref={popup}
            className={clsx(styles.popup, styles.menuPopup)}
            finalFocus={finalFocus}
          >
            {items.map((it, i) =>
              it.type === 'separator' ? (
                <BaseMenu.Separator key={i} className={styles.sep} />
              ) : (
                <BaseMenu.Item
                  key={i}
                  className={clsx(styles.item, it.danger && styles.itemDanger)}
                  onClick={() => {
                    selected.current = it.onSelect;
                  }}
                >
                  {it.label}
                  {it.shortcut ? <span className={styles.shortcut}>{it.shortcut}</span> : null}
                </BaseMenu.Item>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
