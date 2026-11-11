import type { ReactElement } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import clsx from 'clsx';
import styles from './kit.module.css';

export type MenuEntry =
  | { type?: 'item'; label: string; shortcut?: string; danger?: boolean; onSelect: () => void }
  | { type: 'separator' };

export function Menu({
  trigger,
  items,
  onOpenChange,
  restoreFocus = true,
}: {
  trigger: ReactElement;
  items: MenuEntry[];
  onOpenChange?: (open: boolean) => void;
  /** false = do not return focus to the trigger on close (the caller hands it elsewhere). */
  restoreFocus?: boolean;
}) {
  return (
    <BaseMenu.Root onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles.positioner} sideOffset={4}>
          <BaseMenu.Popup className={clsx(styles.popup, styles.menuPopup)} finalFocus={restoreFocus}>
            {items.map((it, i) =>
              it.type === 'separator' ? (
                <BaseMenu.Separator key={i} className={styles.sep} />
              ) : (
                <BaseMenu.Item
                  key={i}
                  className={clsx(styles.item, it.danger && styles.itemDanger)}
                  onClick={it.onSelect}
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
