import { useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { QuitContext } from '../app/quitContext';
import type { CaptionButton, WindowState } from '@contract/types';
import { invoke } from '../ipc/commands';
import { listen } from '../ipc/events';
import { createCaptionLink } from './captionLink';
import { measureCaptionRects } from './captionRects';
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from './icons';
import styles from './CaptionButtons.module.css';
import './tokens.css';

interface Props {
  windowState: WindowState | null;
  /** false while the bar is hidden: reports `rects: null` so no caption hit-testing remains. */
  active?: boolean;
  /** Close fallback (native overlay unavailable) and keyboard close. Default: app_quit. */
  onClose?: () => void;
}

const defaultClose = () => {
  void invoke('app_quit', {}).catch(() => undefined);
};

/**
 * Minimize / maximize-restore / close, 46 x 40. When the Rust overlay is active (ADR-003) it
 * owns pointer activation and paints through window://caption-state; otherwise
 * (window_set_caption_rects -> NOT_IMPLEMENTED) these buttons use :hover and onClick.
 */
export function CaptionButtons({ windowState, active = true, onClose }: Props) {
  const appQuit = useContext(QuitContext);
  const closeApp = onClose ?? appQuit ?? defaultClose;
  const box = useRef<HTMLDivElement>(null);
  const min = useRef<HTMLButtonElement>(null);
  const max = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [paint, setPaint] = useState<{
    hovered: CaptionButton | null;
    pressed: CaptionButton | null;
  }>({ hovered: null, pressed: null });

  const [sender] = useState(createCaptionLink);

  const maximized = windowState?.maximized ?? false;
  const scale = windowState?.scaleFactor;
  const visible = windowState?.visible ?? true;

  const report = () => {
    const rects =
      active && visible
        ? measureCaptionRects(
            { minimize: min.current, maximize: max.current, close: close.current },
            window.innerWidth,
            window.innerHeight,
          )
        : null;
    sender.push(rects);
  };

  const reportRef = useRef(report);
  useLayoutEffect(() => {
    reportRef.current = report;
  });

  // Mount, activation, DPI / maximize / visibility changes.
  useLayoutEffect(report, [active, visible, scale, maximized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Layout changes: viewport resize and bar resizes. Set up once (#1): re-creating the observer on
  // every render re-reported (and re-sent) the rects on every reader render. Rust still clears the
  // rects itself on resize/DPI/hide and waits for this report, so nothing is de-duplicated here.
  useEffect(() => {
    const onResize = () => reportRef.current();
    window.addEventListener('resize', onResize);
    // Absent in jsdom (tests); always present in WebView2.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    if (box.current?.parentElement) ro?.observe(box.current.parentElement);
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, []);

  // Unmount (e.g. fullscreen swaps in "Exit full screen"): disable hit-testing.
  useEffect(() => () => sender.push(null), [sender]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen('window://caption-state', (p) => {
      if (!disposed) setPaint({ hovered: p.hovered, pressed: p.pressed });
    })
      .then((un) => (disposed ? un() : (stop = un)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  // With the overlay active, mouse presses never reach the webview; only keyboard-generated
  // clicks (detail 0) do, and those keep using the commands (contract: Activation).
  const run = (action: () => void) => (e: MouseEvent) => {
    if (sender.isNative() && e.detail !== 0) return;
    action();
  };
  const warn = (e: unknown) => console.warn('window command failed', e);
  const attrs = (b: CaptionButton) => ({
    'data-hover': paint.hovered === b || undefined,
    'data-pressed': paint.pressed === b || undefined,
  });

  return (
    <div
      ref={box}
      className={styles.group}
      data-inactive={windowState?.focused === false || undefined}
    >
      <button
        ref={min}
        type="button"
        className={styles.btn}
        aria-label="Minimize"
        {...attrs('minimize')}
        onClick={run(() => void invoke('window_minimize', {}).catch(warn))}
      >
        <MinimizeGlyph />
      </button>
      <button
        ref={max}
        type="button"
        className={styles.btn}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        {...attrs('maximize')}
        onClick={run(() => void invoke('window_toggle_maximize', {}).catch(warn))}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        ref={close}
        type="button"
        className={`${styles.btn} ${styles.close}`}
        aria-label="Close"
        {...attrs('close')}
        onClick={run(closeApp)}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
