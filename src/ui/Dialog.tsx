import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useOverlay } from '../state/overlayStore';
import styles from './kit.module.css';

export interface DialogProps {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Body between the description and the actions (e.g. a text field). */
  children?: ReactNode;
  title: string;
  description?: string;
  /** Action buttons; wrap a button in <DialogClose> to dismiss. */
  actions: ReactNode;
}

export function Dialog({
  trigger,
  open,
  onOpenChange,
  children,
  title,
  description,
  actions,
}: DialogProps) {
  const [inner, setInner] = useState(false);
  useOverlay(useId(), 'modal', open ?? inner); // #13: dialogs own the keyboard and Escape
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        setInner(next);
        onOpenChange?.(next);
      }}
    >
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Popup className={styles.dialog}>
          <BaseDialog.Title className={styles.dialogTitle}>{title}</BaseDialog.Title>
          {description ? (
            <BaseDialog.Description className={styles.dialogDesc}>
              {description}
            </BaseDialog.Description>
          ) : null}
          {children}
          <div className={styles.dialogActions}>{actions}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function DialogClose({ children }: { children: ReactElement }) {
  return <BaseDialog.Close render={children} />;
}
