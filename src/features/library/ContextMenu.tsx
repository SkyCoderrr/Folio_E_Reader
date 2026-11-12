import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useOverlay } from '../../state/overlayStore';
import clsx from 'clsx';
import kit from '../../ui/kit.module.css';
import styles from './LibraryView.module.css';

export interface CtxItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/** Small controlled menu opened at a point (right-click, Shift+F10 or the more button). */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CtxItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useOverlay(useId(), 'modal', true); // #13: library shortcuts stay off while it is open

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const move = (dir: number) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + dir + els.length) % els.length]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Book actions"
      className={clsx(kit.popup, styles.ctx)}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(e.key === 'ArrowDown' ? 1 : -1);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={clsx(kit.item, styles.ctxItem, it.danger && kit.itemDanger)}
          onClick={() => {
            onClose();
            it.onSelect();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
