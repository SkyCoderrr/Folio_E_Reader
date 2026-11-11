import type { MouseEvent, ReactNode } from 'react';
import { invoke } from '../ipc/commands';
import { CaptionButtons } from './CaptionButtons';
import { IconButton } from './IconButton';
import { PanelLeftCloseIcon, PanelLeftIcon } from './icons';
import { NO_DRAG_SELECTOR, dragAction } from './titleBarActions';
import { useShortcut } from './useShortcut';
import { useWindowState } from './useWindowState';
import styles from './TitleBar.module.css';
import './tokens.css';

export interface SidebarToggle {
  open: boolean;
  onToggle: () => void;
  /** Tooltip shortcut. Default "T". */
  shortcut?: string;
}

interface Props {
  /** Title slot (app name, or "Book - Chapter"). */
  title?: ReactNode;
  /** Slot right after the sidebar toggle, e.g. a "Library" back button. */
  leading?: ReactNode;
  /** Slot before the caption buttons, e.g. Aa / Layout / overflow. */
  actions?: ReactNode;
  /** Renders the sidebar toggle (PanelLeft, never a hamburger). Omit to hide it. */
  sidebar?: SidebarToggle;
  /** false while the bar is hidden: caption hit-testing is disabled. Default true. */
  captionActive?: boolean;
  /** Hide caption buttons (window.titleBar = "native"). Default true. */
  showCaptionButtons?: boolean;
  /** Close fallback / keyboard close. Default: app_quit. */
  onClose?: () => void;
}

const warn = (e: unknown) => console.warn('window command failed', e);

/** Frameless title bar: drag region, slots, caption buttons (PRD 6.8). */
export function TitleBar({
  title,
  leading,
  actions,
  sidebar,
  captionActive = true,
  showCaptionButtons = true,
  onClose,
}: Props) {
  const windowState = useWindowState();
  const fullscreen = windowState?.fullscreen ?? false;
  const fullscreenKey = useShortcut('fullscreen.toggle');

  const onMouseDown = (e: MouseEvent<HTMLElement>) => {
    // React bubbles events from portals (menus, popovers) through the component tree, so a press on a
    // ⋯ menu item reaches this handler; starting a native drag there swallowed the click (t41u).
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as Element).closest(NO_DRAG_SELECTOR)) return;
    const action = dragAction(e);
    if (action === 'toggle-maximize') void invoke('window_toggle_maximize', {}).catch(warn);
    else if (action === 'drag') void invoke('window_start_drag', {}).catch(warn);
  };

  return (
    <header
      className={styles.bar}
      data-inactive={windowState?.focused === false || undefined}
      onMouseDown={onMouseDown}
    >
      {sidebar ? (
        <div className={styles.sidebar}>
          <IconButton
            label="Contents"
            action="toc.toggle"
            shortcut={sidebar.shortcut}
            align="start"
            aria-pressed={sidebar.open}
            onClick={sidebar.onToggle}
          >
            {sidebar.open ? <PanelLeftCloseIcon /> : <PanelLeftIcon />}
          </IconButton>
        </div>
      ) : null}
      {leading ? <div className={styles.leading}>{leading}</div> : null}
      <div className={styles.title}>{title}</div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {showCaptionButtons ? (
        fullscreen ? (
          <button
            type="button"
            className={styles.exitFullscreen}
            onClick={() => void invoke('window_set_fullscreen', { fullscreen: false }).catch(warn)}
          >
            Exit Full Screen
            <kbd className={styles.kbd}>{fullscreenKey}</kbd>
          </button>
        ) : (
          <CaptionButtons windowState={windowState} active={captionActive} onClose={onClose} />
        )
      ) : null}
    </header>
  );
}
