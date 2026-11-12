import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import type { BookOpenResult, BookRecord } from '@contract/types';
import { ALargeSmall } from 'lucide-react';
import { useSettings } from '../../state/settingsStore';
import { TxtSettingsDialogs } from '../txt/TxtSettingsDialogs';
import { AutoScrollPill } from '../autoscroll/AutoScrollPill';
import { BookmarkMark } from '../toc/BookmarkMark';
import { AppearancePanel } from '../appearance/AppearancePanel';
import { TocSidebar, sidebarModeFor } from '../toc/TocSidebar';
import { IconButton } from '../../ui/IconButton';
import { ArrowLeftIcon } from '../../ui/icons';
import { useWindowState } from '../../ui/useWindowState';
import { SizeLabel } from '../../ui/SizeLabel';
import { useShortcuts } from '../../ui/useShortcut';
import type { MenuEntry } from '../../ui/Menu';
import { ReaderChrome } from './ReaderChrome';
import { ReaderTitle } from './ReaderChrome.title';
import { ReaderFooter } from './ReaderFooter';
import { footerReadout } from './footerReadout';
import { ReaderSession, type ReaderState } from './session/ReaderSession';

interface Props {
  book: BookRecord;
  openedData?: BookOpenResult;
  onBack(): void;
  onQuit(): void;
  onSettings?(): void;
  suspended?: boolean;
  saveRef: RefObject<(() => Promise<void>) | null>;
}
/** RS-10.1 / NAV-02.1: at >= 1280 px open panels push the text column instead of covering it. */
export function shiftStyle(winW: number, sidebarPush: boolean, panelOpen: boolean): CSSProperties | undefined {
  const left = sidebarPush ? 'var(--sidebar-width)' : '0px';
  const right = panelOpen && winW >= 1280 ? 'var(--panel-width)' : '0px';
  if (left === '0px' && right === '0px') return undefined;
  return { marginLeft: left, width: `calc(100% - ${left} - ${right})` };
}

const noSubscribe = () => () => undefined;

/** One ReaderSession per mounted book (created in the effect, so StrictMode's remount gets a fresh one). */
function useReaderSession(
  book: BookRecord,
  host: RefObject<HTMLDivElement | null>,
  onBack: () => void,
  suspended: boolean,
  saveRef: RefObject<(() => Promise<void>) | null>,
  openedData?: BookOpenResult,
): [ReaderSession | null, ReaderState | null] {
  const [session, setSession] = useState<ReaderSession | null>(null);
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  });
  useEffect(() => {
    const s = new ReaderSession(book, host.current!, { onBack: () => backRef.current() }, openedData);
    s.start();
    setSession(s);
    const save = () => s.save();
    saveRef.current = save;
    return () => {
      if (saveRef.current === save) saveRef.current = null;
      s.dispose();
    };
  }, [book, host, saveRef, openedData]);
  useEffect(() => session?.setSuspended(suspended), [session, suspended]);
  const state = useSyncExternalStore(session?.subscribe ?? noSubscribe, () => session?.getState() ?? null);
  return [session, state];
}

export function ReaderView({ book, openedData, onBack, onQuit, saveRef, onSettings, suspended = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [session, state] = useReaderSession(book, host, onBack, suspended, saveRef, openedData);
  const chromeDelay = useSettings((s) => s.settings.chrome.autoHideDelayMs);
  const footerProgress = useSettings((s) => s.settings.chrome.footerProgress);
  const cursorDelay = useSettings((s) => s.settings.cursor.autoHideDelayMs);
  const flowSetting = useSettings((s) => s.settings.reader.flow);
  const pagesSetting = useSettings((s) => s.settings.reader.pagesPerView);
  const colors = useSettings((s) => s.effectiveStyle.colors);
  const theme = useMemo(
    () => ({ background: colors.background, text: colors.text, accent: colors.accent }),
    [colors.background, colors.text, colors.accent],
  );
  const [txtMode, setTxtMode] = useState<'encoding' | 'chapters' | null>(null);
  const sc = useShortcuts();
  const windowState = useWindowState();
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let timer: ReturnType<typeof setTimeout>;
    const cursor = (hidden: boolean) => {
      mount.style.cursor = hidden ? 'none' : '';
      mount.querySelectorAll('iframe').forEach((frame) => {
        const doc = frame.contentDocument;
        if (!doc?.head) return;
        doc.getElementById('er-idle-cursor')?.remove();
        if (hidden) {
          const style = doc.createElement('style');
          style.id = 'er-idle-cursor';
          style.textContent = '* { cursor: none !important; }';
          doc.head.append(style);
        }
      });
    };
    const reveal = () => {
      clearTimeout(timer);
      cursor(false);
      if (cursorDelay && !suspended) timer = setTimeout(() => cursor(true), cursorDelay);
    };
    mount.addEventListener('reader-pointer-activity', reveal);
    mount.addEventListener('load', reveal, true);
    window.addEventListener('pointermove', reveal);
    window.addEventListener('keydown', reveal);
    reveal();
    return () => {
      clearTimeout(timer);
      cursor(false);
      mount.removeEventListener('reader-pointer-activity', reveal);
      mount.removeEventListener('load', reveal, true);
      window.removeEventListener('pointermove', reveal);
      window.removeEventListener('keydown', reveal);
    };
  }, [cursorDelay, suspended]);

  // Chrome props are memoised so a position or stats update does not rebuild the bar (#1).
  const fullscreen = windowState?.fullscreen ?? false;
  const effectivePages = state?.effectivePages ?? 1;
  const layout = useMemo(
    () =>
      session
        ? {
            pagesPerView: pagesSetting === 2 ? (2 as const) : (1 as const),
            onPagesPerViewChange: session.setPages,
            flow: flowSetting,
            onFlowChange: session.setFlow,
            effectivePagesPerView: effectivePages,
          }
        : undefined,
    [session, pagesSetting, flowSetting, effectivePages],
  );
  const pinned = state?.pinned ?? false;
  const autoActive = !!state && state.auto.state !== 'off';
  const commands = useMemo<MenuEntry[]>(
    () =>
      session
        ? [
            ...(book.format === 'txt'
              ? [
                  { label: 'Text Encoding…', onSelect: () => setTxtMode('encoding') },
                  { label: 'Chapter Detection…', onSelect: () => setTxtMode('chapters') },
                ]
              : []),
            { label: 'Settings', shortcut: sc('settings.open'), onSelect: () => onSettings?.() },
            { label: 'Appearance', shortcut: sc('appearance.toggle'), onSelect: () => session.toggleAppearance(false) },
            { label: 'Contents', shortcut: sc('toc.toggle'), onSelect: () => session.showSidebar('contents', false, true) },
            { label: 'Bookmarks', shortcut: sc('bookmarks.show'), onSelect: () => session.showSidebar('bookmarks', false) },
            { label: 'Add Bookmark', shortcut: sc('bookmark.toggle'), onSelect: session.toggleBookmark },
            {
              label: flowSetting === 'scroll' ? 'Paged' : 'Scroll',
              shortcut: sc('layout.toggleFlow'),
              onSelect: () => session.setFlow(flowSetting === 'scroll' ? 'paged' : 'scroll'),
            },
            {
              label: pagesSetting === 2 ? 'One Page' : 'Two Pages',
              shortcut: sc('layout.togglePages'),
              onSelect: () => session.setPages(pagesSetting === 2 ? 1 : 2),
            },
            {
              label: fullscreen ? 'Exit Full Screen' : 'Full Screen',
              shortcut: sc('fullscreen.toggle'),
              onSelect: session.toggleFullscreen,
            },
            { label: pinned ? 'Auto-hide toolbar' : 'Keep toolbar visible', shortcut: sc('chrome.toggle'), onSelect: () => session.handle('chrome.toggle', 'down') },
            { label: autoActive ? 'Stop auto-scroll' : 'Start auto-scroll', shortcut: sc('autoscroll.toggle'), onSelect: () => session.handle('autoscroll.toggle', 'down') },
            { type: 'separator' },
            { label: 'Back to Library', shortcut: sc('book.close'), onSelect: session.back },
          ]
        : [],
    [session, book.format, sc, onSettings, flowSetting, pagesSetting, fullscreen, pinned, autoActive],
  );
  const bookmarks = state?.bookmarks;
  const bookmarkRows = useMemo(
    () =>
      (bookmarks ?? []).map((b) => ({
        id: b.id,
        label: b.chapterTitle ?? 'Bookmark',
        excerpt: b.snippet ?? '',
        progress: b.progress,
        createdAt: new Date(b.createdAt).toISOString(),
      })),
    [bookmarks],
  );
  const sidebarOpen = state?.sidebar.open ?? false;
  const appearanceOpen = state?.appearance.open ?? false;
  const sidebarToggle = useMemo(
    () => (session ? { open: sidebarOpen, onToggle: () => session.showSidebar('contents', false, true) } : undefined),
    [session, sidebarOpen],
  );
  const bookTitle = state?.title ?? book.title;
  const chapter = state?.chapter ?? undefined;
  const title = useMemo(() => <ReaderTitle book={bookTitle} chapter={chapter} />, [bookTitle, chapter]);
  const actions = useMemo(
    () => (
      <IconButton label="Appearance" action="appearance.toggle" onClick={() => session?.toggleAppearance(false)}>
        <ALargeSmall size={20} strokeWidth={1.5} aria-hidden />
      </IconButton>
    ),
    [session],
  );
  const leading = useMemo(
    () => (
      <IconButton label="Back" action="book.close" onClick={() => session?.back()}>
        <ArrowLeftIcon />
      </IconButton>
    ),
    [session],
  );

  const position = state?.position ?? null;
  // Stable chrome callbacks and footer, so a position or stats update does not rebuild the bar (#1).
  const focusHome = useCallback(() => host.current, []);
  const onSurfacePress = useCallback(() => session?.closeAppearanceOnPress() ?? false, [session]);
  const estimates = state?.estimates;
  const progress = position?.progress;
  const footer = useMemo(
    () => <ReaderFooter {...estimates} chapter={chapter} progress={progress} />,
    [estimates, chapter, progress],
  );
  // Saved percent and section label remain visible while a cold cache is measured.
  const readout = !state ? null : footerReadout(footerProgress, state.ordinal, position?.progress)
    ?? (state.measuring && footerProgress !== 'off' ? 'Preparing chapters…' : null);
  const mountShift = shiftStyle(winW, sidebarOpen && sidebarModeFor(winW) === 'push', appearanceOpen);
  return (
    <ReaderChrome
      autoHideDelayMs={chromeDelay}
      title={title}
      theme={theme}
      pinned={pinned}
      focusHome={focusHome}
      onSurfacePress={onSurfacePress}
      menuOpen={appearanceOpen || sidebarOpen || txtMode !== null}
      sidebar={sidebarToggle}
      actions={actions}
      layout={layout}
      commands={commands}
      onClose={onQuit}
      leading={leading}
      readout={readout}
      footer={footer}
    >
      <div ref={host} className="reader-mount" data-reading-surface="" tabIndex={-1} style={mountShift} />
      <SizeLabel px={state?.sizeLabel.px ?? null} stamp={state?.sizeLabel.stamp ?? 0} />
      {state &&
        !suspended &&
        !sidebarOpen &&
        !appearanceOpen &&
        !txtMode &&
        <div data-bookmark-marks="" style={{ '--accent': colors.accent } as CSSProperties}>
          {state.marks.map((mark) => (
            <div key={mark.id} style={{ position: 'absolute', left: mark.left, top: mark.top }}>
              <BookmarkMark onClick={() => session?.deleteBookmark(mark.id)} />
            </div>
          ))}
        </div>}
      {state?.auto.visible && (
        <AutoScrollPill
          active={true}
          paused={state.auto.state === 'paused'}
          speedLabel={state.auto.speed.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' px/s'}
        />
      )}
      {session && state && (
        <TocSidebar
          open={sidebarOpen}
          mode={sidebarModeFor(winW)}
          animate={state.sidebar.animate}
          tab={state.sidebar.tab}
          onTabChange={session.setSidebarTab}
          toc={state.toc}
          spans={state.spans}
          reading={state.reading}
          readKeys={state.readKeys}
          onNavigate={session.navigateHref}
          bookmarks={bookmarkRows}
          onBookmarkOpen={session.openBookmark}
          onBookmarkDelete={session.deleteBookmark}
        />
      )}
      {txtMode && session && (
        <TxtSettingsDialogs
          target={{ bookId: book.id, mode: txtMode }}
          onClose={() => setTxtMode(null)}
          onApply={(patch) => session.applyTxtPrefs(patch)}
        />
      )}
      <AppearancePanel
        open={appearanceOpen}
        instant={state?.appearance.byKey ?? false}
        onClose={() => session?.closeAppearance()}
      />
      {state?.fatal && (
        <div className="reader-error" role="alert">
          {state.fatal}
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      )}
    </ReaderChrome>
  );
}
