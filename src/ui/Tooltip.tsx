import { useEffect, useRef, useState, type ReactNode } from 'react';
import { currentTooltipDelay, noteTooltipClosed } from './tooltipTiming';
import styles from './Tooltip.module.css';

interface Props {
  label: string;
  /** Shown beside the label, e.g. "T" or "Ctrl+W". */
  shortcut?: string;
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
}

/** 500 ms delay, 125 ms fade, adjacent tooltips open instantly (PRD 6.6). */
export function Tooltip({ label, shortcut, align = 'center', children }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const openRef = useRef(false);
  const set = (v: boolean) => {
    openRef.current = v;
    setOpen(v);
  };
  const show = () => {
    window.clearTimeout(timer.current);
    const d = currentTooltipDelay();
    if (d === 0) set(true);
    else timer.current = window.setTimeout(() => set(true), d);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    if (openRef.current) noteTooltipClosed();
    set(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span
      className={styles.wrap}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // Only keyboard focus: a click focuses the button but should not pop the tooltip again.
        if ((e.target as Element).matches(':focus-visible')) show();
      }}
      onBlur={hide}
    >
      {children}
      <span role="tooltip" className={styles.tip} data-open={open} data-align={align}>
        {label}
        {shortcut ? <kbd className={styles.kbd}>{shortcut}</kbd> : null}
      </span>
    </span>
  );
}
