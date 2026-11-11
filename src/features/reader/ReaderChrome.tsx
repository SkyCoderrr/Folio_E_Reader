import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { TitleBar, type SidebarToggle } from '../../ui/TitleBar';
import {
  HIDE_GRACE_MS,
  REVEAL_ZONE_PX,
  chromeWantsVisible,
  inRevealZone,
  isPinKey,
} from '../../ui/chromeReveal';
import { Menu, type MenuEntry } from '../../ui/Menu';
import { Popover } from '../../ui/Popover';
import { Segmented } from '../../ui/Segmented';
import { useShortcut } from '../../ui/useShortcut';
import { chromeColors } from './ReaderChrome.colors';
import styles from './ReaderChrome.module.css';
import '../../ui/tokens.css';

export interface ReaderTheme {
  /** Reading-surface background (any CSS colour). Default: Dark preset. */
  background: string;
  /** Reading text colour; chrome text adopts it. Default: Dark preset. */
  text: string;
  /** Preset accent (RS-07.1): TOC current-row tint, bookmark marks and focus rings follow it. */
  accent?: string;
}

export interface ReaderLayoutControl {
  pagesPerView: 1 | 2;
  onPagesPerViewChange: (pages: 1 | 2) => void;
  flow?: 'scroll' | 'paged';
  onFlowChange?: (flow: 'scroll' | 'paged') => void;
  effectivePagesPerView?: 1 | 2;
}

interface Props {
  /** Title slot of the top bar, e.g. "Book - Chapter". */
  title?: ReactNode;
  /** Slot after the sidebar toggle, e.g. a "Library" back button. */
  leading?: ReactNode;
  /** Slot before the caption buttons, e.g. Aa / Layout / overflow. */
  actions?: ReactNode;
  /** Sidebar toggle; pass only while the TOC sidebar is mounted. */
  sidebar?: SidebarToggle;
  /** "Layout" menu (One page | Two pages). Omit to hide it. */
  layout?: ReaderLayoutControl;
  /** The "More" menu: every reader command with its shortcut. Omit to hide it. */
  commands?: MenuEntry[];
  /** Minimal footer content (position, time left). Auto-hides with the bar. */
  footer?: ReactNode;
  /** t31u: text-only reading-progress readout (e.g. "6/24 · 37%"); shown while the chrome is hidden. */
  readout?: string | null;
  /** Reading surface + footer follow the preset; other chrome stays dark (UI-02, 2026-11-10). */
  theme?: ReaderTheme;
  /** Set true while one of the bar's menus/popovers is open: keeps the chrome visible. */
  menuOpen?: boolean;
  /** Controlled pin (H). Omit for internal state. */
  pinned?: boolean;
  /** Disable when the scoped key router owns H. */
  keyboardPin?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  /** Called when the chrome's visibility changes. */
  onVisibleChange?: (visible: boolean) => void;
  onClose?: () => void;
  /** Called after the bar's own menu closes with focus left in the bar: move focus to the text. */
  onMenusClosed?: () => void;
  /**
   * A press on the reading surface (an element marked `data-reading-surface`, or inside a book
   * iframe, which reports it as a `reader-pointer-down` event). Return true if it closed a panel:
   * the press is then consumed (no page turn, link or selection). The Layout popover always closes.
   */
  onSurfacePress?: () => boolean;
  /** The solid reading area. */
  autoHideDelayMs?: number;
  children: ReactNode;
}

/**
 * Reader layout frame. The reading area fills the window; the top bar and footer overlay it
 * (opacity only, they never reflow text) and auto-hide per PRD 6.8.
 */
export function ReaderChrome({
  title,
  leading,
  actions,
  sidebar,
  layout,
  commands,
  footer,
  readout,
  theme,
  menuOpen: menuOpenProp = false,
  pinned: pinnedProp,
  keyboardPin = true,
  onPinnedChange,
  onVisibleChange,
  onClose,
  onMenusClosed,
  onSurfacePress,
  children,
  autoHideDelayMs = HIDE_GRACE_MS,
}: Props) {
  const [pinnedState, setPinnedState] = useState(false);
  const pinned = pinnedProp ?? pinnedState;
  const [pointerInZone, setPointerInZone] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [lingering, setLingering] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const menuOpen = menuOpenProp || layoutOpen || commandsOpen;
  const barRef = useRef<HTMLDivElement>(null);
  const wasOwnMenuOpen = useRef(false);
  // When any menu, popover or panel closes, focus returns to the text so the idle rule hides the
  // chrome again (the trigger would otherwise keep focusWithin true forever).
  useEffect(() => {
    const was = wasOwnMenuOpen.current;
    wasOwnMenuOpen.current = menuOpen;
    if (!was || menuOpen) return;
    const t = window.setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      // Focus is still in the closing popup, on the trigger or nowhere: hand it to the reader.
      if (
        !a ||
        a === document.body ||
        barRef.current?.contains(a) ||
        a.closest('[role="dialog"], [role="menu"]')
      ) {
        (onMenusClosed ?? (() => a?.blur()))();
        setFocusWithin(false);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [menuOpen, onMenusClosed]);
  // Pressing the reading surface closes the Layout popover and any panel the owner reports (t24u).
  // Base UI closes the popover itself for presses in the host document, so a window-capture
  // snapshot (taken before it does) decides whether the press was an outside press; a press inside
  // a book iframe never reaches this document, the iframe reports it instead.
  const readingRef = useRef<HTMLElement>(null);
  const layoutOpenRef = useRef(false);
  const pressRef = useRef(onSurfacePress);
  useEffect(() => {
    layoutOpenRef.current = layoutOpen;
    pressRef.current = onSurfacePress;
  });
  useEffect(() => {
    const main = readingRef.current;
    if (!main) return;
    let layoutAtPress = false;
    const snapshot = () => {
      layoutAtPress = layoutOpenRef.current;
    };
    const onSurface = (e: Event) => {
      const target = e.target as Element | null;
      if (!target?.closest?.('[data-reading-surface]')) return;
      const fromBook = e.type === 'reader-pointer-down';
      if (!fromBook && (e as PointerEvent).button !== 0) return;
      const layoutWas = fromBook ? layoutOpenRef.current : layoutAtPress;
      const closed = pressRef.current?.() ?? false;
      if (!layoutWas && !closed) return;
      setLayoutOpen(false);
      if (fromBook) {
        (e as CustomEvent<{ consumed: boolean }>).detail.consumed = true;
        return;
      }
      // Host-document press (page margin): keep it from selecting or turning a page.
      const stop = (ev: Event) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      };
      const done = () => {
        main.removeEventListener('mousedown', stop, true);
        main.removeEventListener('click', onClick, true);
        window.clearTimeout(timer);
      };
      const onClick = (ev: Event) => {
        stop(ev);
        done();
      };
      const timer = window.setTimeout(done, 1000);
      main.addEventListener('mousedown', stop, true);
      main.addEventListener('click', onClick, true);
    };
    window.addEventListener('pointerdown', snapshot, true);
    main.addEventListener('pointerdown', onSurface, true);
    main.addEventListener('reader-pointer-down', onSurface);
    return () => {
      window.removeEventListener('pointerdown', snapshot, true);
      main.removeEventListener('pointerdown', onSurface, true);
      main.removeEventListener('reader-pointer-down', onSurface);
    };
  }, []);
  const flowKey = useShortcut('layout.toggleFlow');
  const pagesKey = useShortcut('layout.togglePages');

  // RS-01.3: un-pinning (H) hides at once and stays hidden until the pointer re-enters the edge zone.
  const [prevPinned, setPrevPinned] = useState(pinned);
  const [prevZone, setPrevZone] = useState(pointerInZone);
  const [hideNow, setHideNow] = useState(false);
  if (pinned !== prevPinned) {
    setPrevPinned(pinned);
    setHideNow(!pinned);
  }
  if (pointerInZone !== prevZone) {
    setPrevZone(pointerInZone);
    if (pointerInZone) setHideNow(false);
  }
  const wants = !hideNow && chromeWantsVisible({ pinned, pointerInZone, hovering, menuOpen, focusWithin });
  // Show immediately; after `wants` drops, linger for a short grace period before hiding.
  const [prevWants, setPrevWants] = useState(false);
  if (wants !== prevWants) {
    setPrevWants(wants);
    setLingering(wants ? false : true);
  }
  useEffect(() => {
    if (wants || !lingering) return;
    const t = window.setTimeout(() => setLingering(false), autoHideDelayMs);
    return () => window.clearTimeout(t);
  }, [wants, lingering, autoHideDelayMs]);
  const visible = wants || (lingering && !hideNow);

  useEffect(() => onVisibleChange?.(visible), [visible, onVisibleChange]);

  // H pins (the keyboard system, M7, will take over this binding).
  const pinRef = useRef({ pinned, onPinnedChange });
  useEffect(() => {
    pinRef.current = { pinned, onPinnedChange };
  });
  useEffect(() => {
    if (!keyboardPin) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isPinKey(e)) return;
      const { pinned: p, onPinnedChange: cb } = pinRef.current;
      setPinnedState(!p);
      cb?.(!p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardPin]);

  // Pointer position over the host document (the top strip below covers iframes).
  useEffect(() => {
    const onMove = (e: PointerEvent) => setPointerInZone(inRevealZone(e.clientY));
    const onLeave = () => setPointerInZone(false);
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // Hover / focus keep the chrome up; shared by the bar and the footer.
  const sensors = {
    onPointerEnter: () => setHovering(true),
    onPointerLeave: () => setHovering(false),
    onFocus: () => setFocusWithin(true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false);
    },
  };

  const style = useMemo(() => {
    if (!theme) return undefined;
    const vars: Record<string, string> = {
      '--reader-bg': theme.background,
      '--reader-fg': theme.text,
    };
    return vars as CSSProperties;
  }, [theme]);

  // Only the footer (inside the reading area) follows the preset; the rest of the chrome stays dark.
  const footerStyle = useMemo(() => {
    const c = theme ? chromeColors(theme.background, theme.text) : null;
    if (!c) return undefined;
    return {
      '--chrome-bg': c.bg,
      '--chrome-text-2': c.text2,
      '--chrome-border': c.border,
    } as CSSProperties;
  }, [theme]);

  const barActions =
    actions || layout || commands ? (
      <>
        {actions}
        {layout ? (
          <Popover
            label="Layout"
            open={layoutOpen}
            onOpenChange={setLayoutOpen}
            restoreFocus={!onMenusClosed}
            trigger={
              <button type="button" className={styles.textButton} aria-label="Layout">
                Layout
                <ChevronGlyph />
              </button>
            }
          >
            <div className={styles.layoutPop}>
              {layout.onFlowChange && (
                <>
                  <div className={styles.layoutHead}>
                    <span>Flow</span>
                    <kbd className={styles.kbd}>{flowKey}</kbd>
                  </div>
                  <Segmented
                    label="Flow"
                    value={layout.flow ?? 'scroll'}
                    options={[
                      { value: 'scroll', label: 'Scroll' },
                      { value: 'paged', label: 'Paged' },
                    ]}
                    onChange={(v) => layout.onFlowChange?.(v === 'paged' ? 'paged' : 'scroll')}
                  />
                </>
              )}
              <div className={styles.layoutHead}>
                <span>Pages</span>
                <kbd className={styles.kbd}>{pagesKey}</kbd>
              </div>
              <Segmented
                label="Pages"
                value={layout.pagesPerView === 2 ? 'two' : 'one'}
                options={[
                  { value: 'one', label: 'One page' },
                  {
                    value: 'two',
                    label:
                      layout.pagesPerView === 2 && layout.effectivePagesPerView === 1
                        ? 'Two pages (window too narrow)'
                        : 'Two pages',
                  },
                ]}
                onChange={(v) => layout.onPagesPerViewChange(v === 'two' ? 2 : 1)}
              />
            </div>
          </Popover>
        ) : null}
        {commands ? (
          <Menu
            onOpenChange={setCommandsOpen}
            restoreFocus={!onMenusClosed}
            items={commands}
            trigger={
              <button type="button" className={styles.iconButton} aria-label="More">
                <MoreGlyph />
              </button>
            }
          />
        ) : null}
      </>
    ) : undefined;

  return (
    <div className={styles.frame} style={style} data-pinned={pinned}>
      <main ref={readingRef} className={styles.reading}>{children}</main>

      {/* Reveal strip: pointer events inside iframes never reach window listeners. */}
      <div
        className={styles.revealStrip}
        style={{ height: REVEAL_ZONE_PX }}
        onPointerEnter={() => setPointerInZone(true)}
        onPointerLeave={() => setPointerInZone(false)}
        aria-hidden="true"
      />

      <div className={styles.chrome} data-visible={visible}>
        <div ref={barRef} className={styles.top} {...sensors}>
          <TitleBar
            title={title}
            leading={leading}
            actions={barActions}
            sidebar={sidebar}
            captionActive={visible}
            onClose={onClose}
          />
        </div>
        {readout ? (
          <div className={styles.readout} style={footerStyle} data-testid="footer-readout">
            {readout}
          </div>
        ) : null}
        {footer ? (
          <footer className={styles.footer} style={footerStyle} {...sensors}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

const ChevronGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={styles.chevron}>
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
  </svg>
);

const MoreGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="5" cy="10" r="1.25" fill="currentColor" />
    <circle cx="10" cy="10" r="1.25" fill="currentColor" />
    <circle cx="15" cy="10" r="1.25" fill="currentColor" />
  </svg>
);
