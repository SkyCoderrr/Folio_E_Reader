import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type {
  ActionId,
  Bookmark,
  BookRecord,
  Locator,
  TxtManifest,
  TxtPrefsPatch,
} from '@contract/types';
import { useSettings, loadSettings, flushSettings } from '../../state/settingsStore';
import { epubSource } from '../../engine/book/epubSource';
import { txtSource, createTxtLocatorBridge } from '../../engine/book/txtSource';
import { TxtSettingsDialogs } from '../txt/TxtSettingsDialogs';
import { prepareTxtPreferences } from '../txt/txtSettings';
import { createLocatorBridge, PositionPersistence } from '../../engine/locator';
import { createRenderer, type ScrollRenderer } from '../../engine/renderers/createRenderer';
import { compileStyle } from '../../engine/style/compileStyle';
import { installKeyRouter } from '../../engine/input/keyRouter';
import { AutoScroller, type AutoScrollState } from '../../engine/input/autoScroller';
import { AutoScrollPill } from '../autoscroll/AutoScrollPill';
import { BookmarkMark } from '../toc/BookmarkMark';
import { buildTocSpans, classifyToc, tocLabelAt, type TocBookInfo } from '../toc/tocModel';
import { planTocAnchors, readTocOffsets } from '../toc/tocOffsets';
import { SmoothScroller } from '../../engine/input/smoothScroller';
import { invoke } from '../../ipc/commands';
import { listen } from '../../ipc/events';
import { pauseReading, subscribeReadingPause } from '../../engine/input/pauseBus';
import { IconButton } from '../../ui/IconButton';
import { ArrowLeftIcon } from '../../ui/icons';
import { useWindowState } from '../../ui/useWindowState';
import { ReaderChrome } from './ReaderChrome';
import { ReaderTitle } from './ReaderChrome.title';
import { ReaderFooter } from './ReaderFooter';
import { sectionChapterLabels } from './ReaderFooter.labels';
import { footerReadout } from './footerReadout';
import { ALargeSmall } from 'lucide-react';
import { AppearancePanel } from '../appearance/AppearancePanel';
import { TocSidebar, sidebarModeFor } from '../toc/TocSidebar';
import { useChapterMemory } from '../toc/useChapterMemory';
import type { ChapterReadApi } from '../toc/chapterMemory';
import { SizeLabel } from '../../ui/SizeLabel';
import { useShortcuts } from '../../ui/useShortcut';
import type { BookSource, TocItem } from '../../engine/book/BookSource';
import type { GoToTarget } from '../../engine/renderers/Renderer';
import { toast } from 'sonner';
import { SessionTracker, readingEstimates } from '../../engine/sessionTracker';
import { sortBookmarks } from '../../engine/bookmarks';
import { localDay } from '../../app/statsModel';
import { buildSectionText } from '../../engine/renderers/flow/sectionText';

interface Props {
  book: BookRecord;
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

type ChapterKeysResult = { chapterKeys: string[] };
// Typed loosely until the contract (v0.6.0) lists the commands; calls are identical either way.
const rawInvoke = invoke as unknown as (name: string, args: object) => Promise<ChapterKeysResult>;
const chapterReadApi: ChapterReadApi = {
  get: async (bookId) => (await rawInvoke('chapters_read_get', { bookId })).chapterKeys,
  mark: async (bookId, chapterKey) =>
    (await rawInvoke('chapter_mark_read', { bookId, chapterKey })).chapterKeys,
};

export function ReaderView({
  book,
  onBack,
  onQuit,
  saveRef,
  onSettings,
  suspended = false,
}: Props) {
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);
  const chromeDelay = useSettings((s) => s.settings.chrome.autoHideDelayMs);
  const footerProgress = useSettings((s) => s.settings.chrome.footerProgress);
  const cursorDelay = useSettings((s) => s.settings.cursor.autoHideDelayMs);
  const host = useRef<HTMLDivElement>(null);
  const [txtMode, setTxtMode] = useState<'encoding' | 'chapters' | null>(null);
  const applyTxt = useRef<((patch?: TxtPrefsPatch) => Promise<void>) | null>(null);
  const [title, setTitle] = useState(book.title);
  const [position, setPosition] = useState<Locator>();
  const [estimates, setEstimates] = useState<ReturnType<typeof readingEstimates>>({});
  const [chapters, setChapters] = useState<(string | null)[]>([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocBook, setTocBook] = useState<TocBookInfo | null>(null);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  // t29u: chapters the reader has actually been in (persisted via chapters_read_get / chapter_mark_read)
  const readKeys = useChapterMemory({
    bookId: book.id,
    api: chapterReadApi,
    toc,
    tocBook,
    position,
    active: !suspended,
  });
  const tocSpans = useMemo(() => (tocBook ? buildTocSpans(toc, tocBook) : []), [toc, tocBook]);
  // t32u: nothing until the EPUB is measured (fragment offsets + char-based progress), so the
  // readout never flashes a wrong chapter index / percent while the book opens.
  const readout = tocBook?.pending ? null : footerReadout(footerProgress, tocSpans, position);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [sidebar, setSidebar] = useState({
    open: false,
    animate: false,
    tab: 'contents' as 'contents' | 'bookmarks',
  });
  const auto = useRef<AutoScroller | null>(null);
  const [autoStatus, setAutoStatus] = useState<{
    state: AutoScrollState;
    speed: number;
    visible: boolean;
  }>({ state: 'off', speed: 40, visible: false });
  const [marks, setMarks] = useState<{ id: string; left: number; top: number }[]>([]);
  const blocked = useRef(false);
  const statsVisibility = useRef<() => void>(() => undefined);
  const panels = useRef<('appearance' | 'sidebar')[]>([]);
  const navigate = useRef<(target: GoToTarget) => void>(() => undefined);
  const toggleBookmark = useRef<() => void>(() => undefined);
  const deleteBookmark = useRef<(id: string) => void>(() => undefined);
  const [effectivePages, setEffectivePages] = useState<1 | 2>(1);
  const flowSetting = useSettings((s) => s.settings.reader.flow);
  const colors = useSettings((s) => s.effectiveStyle.colors);
  const theme = useMemo(
    () => ({ background: colors.background, text: colors.text, accent: colors.accent }),
    [colors.background, colors.text, colors.accent],
  );
  const pagesSetting = useSettings((s) => s.settings.reader.pagesPerView);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pinned, setPinned] = useState(false);
  const sc = useShortcuts();
  const [sizeLabel, setSizeLabel] = useState<{ px: number | null; stamp: number }>({ px: null, stamp: 0 });
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const pushMode = sidebarModeFor(winW) === 'push';
  const [appearance, setAppearance] = useState<{ open: boolean; byKey: boolean }>({
    open: false,
    byKey: false,
  });
  useEffect(() => {
    blocked.current = suspended || appearance.open || sidebar.open || txtMode !== null;
    if (blocked.current) auto.current?.pause();
    statsVisibility.current();
  }, [suspended, appearance.open, sidebar.open, txtMode]);
  const showSidebar = useCallback(
    (tab: 'contents' | 'bookmarks', byKey: boolean, toggle = false) => {
      const wasOpen = panels.current.includes('sidebar');
      panels.current = panels.current.filter((p) => p !== 'sidebar');
      const open = !toggle || !wasOpen;
      if (open) panels.current.push('sidebar');
      setSidebar({ open, animate: !byKey, tab });
      useSettings.getState().patch({ ui: { tocOpen: open } });
    },
    [],
  );
  const closePanel = useCallback((byKey: boolean) => {
    const panel = panels.current.pop();
    if (panel === 'appearance') setAppearance({ open: false, byKey });
    if (panel === 'sidebar') {
      setSidebar((s) => ({ ...s, open: false, animate: !byKey }));
      useSettings.getState().patch({ ui: { tocOpen: false } });
      if (byKey) host.current?.focus({ preventScroll: true });
    }
    return !!panel;
  }, []);
  // A press on the reading surface (also inside the book iframe) closes the Appearance panel.
  const closeAppearanceOnPress = useCallback(() => {
    if (!panels.current.includes('appearance')) return false;
    panels.current = panels.current.filter((p) => p !== 'appearance');
    setAppearance({ open: false, byKey: false });
    return true;
  }, []);
  const changeAppearance = useCallback((byKey: boolean) => {
    const open = !panels.current.includes('appearance');
    panels.current = panels.current.filter((p) => p !== 'appearance');
    if (open) panels.current.push('appearance');
    setAppearance({ open, byKey });
  }, []);
  const windowState = useWindowState();
  const fullscreen = useRef(false);
  useEffect(() => {
    fullscreen.current = windowState?.fullscreen ?? false;
  }, [windowState]);
  useEffect(() => {
    let disposed = false;
    let renderer: ScrollRenderer | undefined;
    let scroller: SmoothScroller | undefined;
    let persistence: PositionPersistence | undefined;
    let source: Awaited<ReturnType<typeof epubSource>> | undefined;
    let manifest: TxtManifest | undefined;
    const stops: (() => void)[] = [];
    let stopRendererEvents = () => {};
    let ready = false;
    // React detaches the iframe DOM before passive effect cleanup. Keep the last
    // live locator so a second save on unmount cannot overwrite it with an empty one.
    let lastLocator: Locator | undefined;
    let sectionChars: number[] | undefined;
    let bossHidden = false;
    let focused = true;
    let jump = false;
    const tracker = new SessionTracker(
      book.id,
      useSettings.getState().settings.stats.idleTimeoutSec * 1000,
      (session) => invoke('stats_session_save', { session }),
    );
    tracker.configure(
      useSettings.getState().settings.stats.enabled,
      useSettings.getState().settings.stats.idleTimeoutSec * 1000,
    );
    tracker.visibility(false);
    const exactPosition = (loc: Locator): Locator => {
      if (!sectionChars || (!loc.cfi && !loc.snippet && loc.charOffset === 0 && loc.progress > 0))
        return loc;
      const total = sectionChars.reduce((a, b) => a + b, 0);
      const globalCharOffset =
        sectionChars.slice(0, loc.sectionIndex).reduce((a, b) => a + b, 0) + loc.charOffset;
      return {
        ...loc,
        globalCharOffset,
        progress: total ? Math.min(1, globalCharOffset / total) : 0,
      };
    };
    const visibilityStats = () =>
      tracker.visibility(
        ready &&
          focused &&
          !document.hidden &&
          !bossHidden &&
          !suspendedRef.current &&
          !blocked.current,
      );
    statsVisibility.current = visibilityStats;
    const activity = () => {
      visibilityStats();
      tracker.activity();
    };
    const tickStats = () => {
      tracker.configure(
        useSettings.getState().settings.stats.enabled,
        useSettings.getState().settings.stats.idleTimeoutSec * 1000,
      );
      visibilityStats();
      tracker.tick();
      void tracker.flushPending().catch(report);
      const loc = renderer?.getLocator();
      if (!useSettings.getState().settings.stats.enabled) setEstimates({});
      else if (loc && sectionChars) {
        const exact = exactPosition(loc);
        const total = sectionChars.reduce((a, b) => a + b, 0);
        setEstimates(
          readingEstimates(
            tracker.speed,
            (sectionChars[loc.sectionIndex] ?? 0) - loc.charOffset,
            total - (exact.globalCharOffset ?? 0),
            /^(zh|ja|ko)/i.test(source?.metadata.language ?? '') || /[㐀-鿿]/u.test(loc.snippet),
          ),
        );
      }
    };
    const statsTimer = setInterval(tickStats, 1000);
    const blurStats = () => {
      focused = false;
      visibilityStats();
      void tracker.flush().catch(report);
    };
    const focusStats = () => {
      focused = true;
      visibilityStats();
    };
    const hiddenStats = () => {
      visibilityStats();
      if (document.hidden) void tracker.flush().catch(report);
    };
    for (const name of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const)
      window.addEventListener(name, activity, true);
    host.current?.addEventListener('reader-manual-input', activity);
    host.current?.addEventListener('reader-pointer-activity', activity);
    window.addEventListener('blur', blurStats);
    window.addEventListener('focus', focusStats);
    document.addEventListener('visibilitychange', hiddenStats);
    stops.push(() => {
      clearInterval(statsTimer);
      for (const name of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const)
        window.removeEventListener(name, activity, true);
      host.current?.removeEventListener('reader-manual-input', activity);
      host.current?.removeEventListener('reader-pointer-activity', activity);
      window.removeEventListener('blur', blurStats);
      window.removeEventListener('focus', focusStats);
      document.removeEventListener('visibilitychange', hiddenStats);
    });
    let pillTimer: ReturnType<typeof setTimeout>;
    let marksFrame = 0;
    const scheduleMarks = () => {
      if (marksFrame || disposed) return;
      marksFrame = requestAnimationFrame(() => {
        marksFrame = 0;
        if (disposed) return;
        const bounds = host.current?.getBoundingClientRect();
        const next = bookmarkRows.flatMap((row) => {
          const rect = renderer?.getLocatorRect(row.locator);
          return rect && bounds
            ? [
                {
                  id: row.id,
                  left: Math.max(bounds.left, rect.marginLeft - 18) - bounds.left,
                  top: Math.max(bounds.top, rect.top) - bounds.top,
                },
              ]
            : [];
        });
        setMarks(next);
      });
    };
    host.current?.addEventListener('scroll', scheduleMarks, true);
    stops.push(() => {
      clearTimeout(pillTimer);
      cancelAnimationFrame(marksFrame);
      host.current?.removeEventListener('scroll', scheduleMarks, true);
    });
    let scrollSettings = useSettings.getState().settings.scroll;
    let pagesPerView = useSettings.getState().settings.reader.pagesPerView;
    let flow = useSettings.getState().settings.reader.flow;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const currentStyle = () => useSettings.getState().effectiveStyle;
    const report = (e: unknown) => {
      if (!disposed)
        setError(
          e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e),
        );
    };
    const save = async () => {
      auto.current?.pause();
      scroller?.stop();
      renderer?.cancelScrollAnimation();
      if (ready && renderer && host.current?.isConnected)
        lastLocator = exactPosition(renderer.getLocator());
      await Promise.all([
        flushSettings(),
        tracker.flush(),
        persistence && lastLocator
          ? persistence.flush(lastLocator)
          : Promise.resolve(),
      ]);
    };
    saveRef.current = save;
    void listen('boss://hidden', () => {
      bossHidden = true;
      visibilityStats();
      pauseReading();
      void save().catch(report);
    })
      .then((stop) => {
        if (disposed) stop();
        else stops.push(stop);
      })
      .catch(report);
    void listen('boss://shown', () => {
      bossHidden = false;
      focused = true;
      visibilityStats();
    })
      .then((stop) => {
        if (disposed) stop();
        else stops.push(stop);
      })
      .catch(report);
    const back = () => {
      void save().then(onBack).catch(report);
    };
    const closeWhileOpening = (e: KeyboardEvent) => {
      if (
        !suspendedRef.current &&
        !ready &&
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === 'KeyW'
      ) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', closeWhileOpening);
    stops.push(() => window.removeEventListener('keydown', closeWhileOpening));
    // Both panels handle Escape locally. Arbitrate before those handlers so focus in
    // the lower panel still dismisses the most recently opened panel first.
    const dismissPanelKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target as Element | null;
      if (
        !target?.closest?.('aside[aria-label="Contents"], aside[aria-label="Appearance"]') ||
        target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
      )
        return;
      if (closePanel(true)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', dismissPanelKey, true);
    stops.push(() => document.removeEventListener('keydown', dismissPanelKey, true));
    const setFullscreen = (value: boolean) => {
      fullscreen.current = value;
      void invoke('window_set_fullscreen', { fullscreen: value }).catch(report);
    };
    const changeFont = (size: number) => {
      useSettings.getState().patchStyle({ font: { size } });
      setSizeLabel((l) => ({ px: currentStyle().font.size, stamp: l.stamp + 1 }));
    };
    let bookmarkRows: Bookmark[] = [];
    let bookmarkWrites = Promise.resolve();
    const updateBookmarks = (rows: Bookmark[]) => {
      bookmarkRows = sortBookmarks(rows);
      if (!disposed) setBookmarks(bookmarkRows);
      scheduleMarks();
    };
    const enqueueBookmark = (write: () => Promise<void>) => {
      bookmarkWrites = bookmarkWrites
        .then(async () => {
          if (!disposed) await write();
        })
        .catch(report);
    };
    const addBookmark = async (args: Pick<Bookmark, 'locator' | 'chapterTitle' | 'snippet'>) => {
      const added = await invoke('bookmark_add', { bookId: book.id, ...args });
      updateBookmarks([...bookmarkRows, added]);
    };
    const removeBookmark = async (row: Bookmark) => {
      await invoke('bookmark_remove', { bookmarkId: row.id });
      updateBookmarks(bookmarkRows.filter((b) => b.id !== row.id));
      if (!disposed)
        toast('Bookmark deleted', {
          action: {
            label: 'Undo',
            onClick: () =>
              enqueueBookmark(() =>
                addBookmark({
                  locator: row.locator,
                  chapterTitle: row.chapterTitle,
                  snippet: row.snippet,
                }),
              ),
          },
        });
    };
    deleteBookmark.current = (id) =>
      enqueueBookmark(async () => {
        const row = bookmarkRows.find((b) => b.id === id);
        if (row) await removeBookmark(row);
      });
    toggleBookmark.current = () => {
      if (!ready || !renderer) return;
      const locator = renderer.getLocator();
      enqueueBookmark(async () => {
        const row = bookmarkRows.find((b) =>
          locator.globalCharOffset !== null && b.locator.globalCharOffset !== null
            ? locator.globalCharOffset === b.locator.globalCharOffset
            : locator.sectionIndex === b.locator.sectionIndex &&
              locator.charOffset === b.locator.charOffset,
        );
        if (row) await removeBookmark(row);
        else
          await addBookmark({
            locator,
            chapterTitle: source
              ? (sectionChapterLabels(source)[locator.sectionIndex] ?? null)
              : null,
            snippet: Array.from(locator.snippet).slice(0, 60).join(''),
          });
      });
    };
    navigate.current = (target) => {
      if (!ready || !renderer) return;
      auto.current?.pause();
      scroller?.stop();
      jump = true;
      void renderer.goTo(target).catch(report);
    };
    const trackChapter = (index: number) => {
      const find = (items: TocItem[]): string | null => {
        for (const item of items) {
          if (source?.resolveHref(item.href)?.index === index) return item.href;
          const nested = find(item.subitems ?? []);
          if (nested) return nested;
        }
        return null;
      };
      setCurrentHref(find(source?.toc ?? []));
    };
    const mountRenderer = async (at?: Locator) => {
      let style = currentStyle();
      let override = useSettings.getState().settings.epub.styleOverride;
      pagesPerView = useSettings.getState().settings.reader.pagesPerView;
      flow = useSettings.getState().settings.reader.flow;
      const created = createRenderer(
        { flow, pagesPerView },
        {
          locatorBridge: manifest
            ? createTxtLocatorBridge(manifest)
            : createLocatorBridge(source!.sections.length),
          pageOverlapLines: scrollSettings.pageOverlapLines,
          pageGapPx: style.layout.pageGap,
          minSpreadWidthPx: useSettings.getState().settings.layout.minSpreadWidthPx,
        },
      );
      renderer = created.renderer;
      setNotice(
        created.fallback === 'grid-unsupported'
          ? 'Two-page view needs a newer WebView2. Showing one page.'
          : '',
      );
      const eventStops = [
        renderer.on('relocate', ({ locator, reason }) => {
          if (disposed || !host.current?.isConnected) return;
          locator = exactPosition(locator);
          lastLocator = locator;
          const css = compileStyle(currentStyle());
          const screenChars =
            Math.max(1, renderer!.getViewportHeight() / css.lineHeightPx) *
            Math.max(1, (host.current?.clientWidth || 800) / css.fontSizePx);
          tracker.relocate(locator, screenChars, jump || !ready || reason !== 'scroll');
          jump = false;
          scheduleMarks();
          setPosition(locator);
          trackChapter(locator.sectionIndex);
          if (ready) persistence?.schedule(locator);
        }),
        renderer.on('load', scheduleMarks),
        renderer.on('section', ({ index }) => trackChapter(index)),
        renderer.on('spread', ({ pagesPerView }) => setEffectivePages(pagesPerView)),
      ];
      stopRendererEvents = () => eventStops.forEach((stop) => stop());
      await renderer.mount(
        host.current!,
        source!,
        compileStyle(style, { styleOverride: override, format: book.format }),
        at,
      );
      if (disposed) return;
      // Controls can change while a section is mounting; apply the latest style in place.
      while (
        !disposed &&
        (JSON.stringify(style) !== JSON.stringify(currentStyle()) ||
          override !== useSettings.getState().settings.epub.styleOverride)
      ) {
        style = currentStyle();
        override = useSettings.getState().settings.epub.styleOverride;
        await renderer.setStyle(
          compileStyle(style, { styleOverride: override, format: book.format }),
        );
      }
      if (disposed) return;
      scrollSettings = useSettings.getState().settings.scroll;
      renderer.setMinSpreadWidth(useSettings.getState().settings.layout.minSpreadWidthPx);
      renderer.setPageOverlapLines(scrollSettings.pageOverlapLines);
      setEffectivePages(renderer.getEffectivePagesPerView());
      scroller = new SmoothScroller(renderer, scrollSettings, undefined, motionQuery.matches);
      auto.current?.stop();
      const controller = new AutoScroller(
        renderer,
        useSettings.getState().settings.autoscroll,
        flow === 'paged',
        motionQuery.matches,
        (state) => {
          if (disposed) return;
          tracker.autoScroll(state === 'running');
          clearTimeout(pillTimer);
          setAutoStatus({ state, speed: controller.settings.speed, visible: state !== 'off' });
          pillTimer = setTimeout(() => setAutoStatus((s) => ({ ...s, visible: false })), 1500);
        },
      );
      auto.current = controller;
      ready = true;
      visibilityStats();
      scheduleMarks();
      if (
        pagesPerView !== useSettings.getState().settings.reader.pagesPerView ||
        flow !== useSettings.getState().settings.reader.flow
      )
        await replaceLayout();
    };
    const replaceLayout = async () => {
      auto.current?.stop();
      scroller!.stop();
      renderer!.cancelScrollAnimation();
      const at = exactPosition(renderer!.getLocator());
      lastLocator = at;
      ready = false;
      await persistence?.flush(at).catch(report);
      if (disposed) return;
      stopRendererEvents();
      renderer!.destroy();
      pagesPerView = useSettings.getState().settings.reader.pagesPerView;
      flow = useSettings.getState().settings.reader.flow;
      await mountRenderer(at);
    };
    const handle = (action: ActionId, phase: 'down' | 'up') => {
      if (suspendedRef.current || !renderer || !scroller || !ready) return false;
      if (action.startsWith('autoscroll.')) {
        if (phase === 'up') return true;
        const controller = auto.current;
        if (!controller) return false;
        if (action === 'autoscroll.toggle' && controller.state !== 'off') controller.stop();
        else if (
          !blocked.current &&
          !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
        ) {
          scroller.stop();
          renderer.cancelScrollAnimation();
          if (action === 'autoscroll.toggle') controller.toggle();
          else if (action === 'autoscroll.pause') controller.togglePause();
          else
            useSettings.getState().patch({
              autoscroll: { speed: controller.adjust(action === 'autoscroll.faster' ? 1 : -1) },
            });
        }
        return true;
      }
      if (phase === 'down') auto.current?.pause();
      // Page-turning renderers (ADR-005): page keys are held like arrows (filmstrip glides while held).
      const pageKey =
        renderer.turnsPages === true && (action === 'page.next' || action === 'page.prev');
      if (action === 'scroll.down' || action === 'scroll.up' || pageKey) {
        renderer.cancelScrollAnimation();
        const direction = action === 'scroll.down' || action === 'page.next' ? 1 : -1;
        if (phase === 'down') scroller.press(direction);
        else scroller.release(direction);
        return true;
      }
      if (phase === 'up') return true;
      const index = renderer.getSectionIndex();
      switch (action) {
        case 'toc.toggle':
          showSidebar('contents', true, true);
          break;
        case 'bookmarks.show':
          showSidebar('bookmarks', true);
          break;
        case 'bookmark.toggle':
          toggleBookmark.current();
          break;
        case 'layout.toggleFlow':
          useSettings
            .getState()
            .setReader({ reader: { flow: flow === 'scroll' ? 'paged' : 'scroll' } });
          break;
        case 'layout.togglePages':
          useSettings
            .getState()
            .setReader({ reader: { pagesPerView: pagesPerView === 1 ? 2 : 1 } });
          break;
        case 'page.next':
          scroller.stop();
          renderer.page(1);
          break;
        case 'page.prev':
          scroller.stop();
          renderer.page(-1);
          break;
        case 'chapter.start':
          jump = true;
          scroller.stop();
          void renderer.goToSectionEdge(index, 'start').catch(report);
          break;
        case 'chapter.end':
          jump = true;
          scroller.stop();
          void renderer.goToSectionEdge(index, 'end').catch(report);
          break;
        case 'book.start':
          jump = true;
          scroller.stop();
          void renderer.goToSectionEdge(0, 'start').catch(report);
          break;
        case 'book.end':
          jump = true;
          scroller.stop();
          void renderer.goToSectionEdge(renderer.sectionCount - 1, 'end').catch(report);
          break;
        case 'font.increase':
          changeFont(currentStyle().font.size + 1);
          break;
        case 'font.decrease':
          changeFont(currentStyle().font.size - 1);
          break;
        case 'font.reset':
          useSettings.getState().resetStyleKey('font.size');
          setSizeLabel((l) => ({ px: currentStyle().font.size, stamp: l.stamp + 1 }));
          break;
        case 'fullscreen.toggle':
          setFullscreen(!fullscreen.current);
          break;
        case 'appearance.toggle':
          changeAppearance(true);
          break;
        case 'dismiss':
          if (closePanel(true)) break;
          else if (fullscreen.current) setFullscreen(false);
          else back();
          break;
        case 'book.close':
          back();
          break;
        case 'app.quit':
          onQuit();
          break;
        case 'chrome.toggle':
          setPinned((p) => !p);
          break;
        default:
          return false;
      }
      return true;
    };
    void (async () => {
      await loadSettings();
      const settings = useSettings.getState().settings;
      setSidebar((s) => ({ ...s, open: settings.ui.tocOpen }));
      if (settings.ui.tocOpen && !panels.current.includes('sidebar'))
        panels.current.push('sidebar');
      scrollSettings = settings.scroll;
      pagesPerView = settings.reader.pagesPerView;
      flow = settings.reader.flow;
      const key = book.id;
      if (disposed) return;
      persistence = new PositionPersistence(key, undefined, report);
      const at = await persistence.restore();
      if (disposed) return;
      if (book.format === 'txt') {
        manifest = await invoke('txt_prepare', { bookId: book.id });
        if (disposed) return;
        source = txtSource(manifest, { title: book.title });
      } else source = await epubSource(convertFileSrc(book.filePath));
      if (disposed) {
        source.destroy();
        return;
      }
      setTitle(source.metadata.title || book.title);
      setChapters(sectionChapterLabels(source));
      setToc(source.toc);
      setTocBook(tocBookInfo(source, book.format, { pending: book.format === 'epub' }));
      updateBookmarks((await invoke('bookmarks_list', { bookId: book.id })) ?? []);
      if (disposed) return;
      await mountRenderer(at);
      if (disposed) return;
      if (manifest) sectionChars = manifest.sections.map((section) => section.chars);
      if (useSettings.getState().settings.stats.enabled) {
        const today = new Date();
        const earliest = new Date(today);
        earliest.setDate(earliest.getDate() - 3659);
        void invoke('stats_query', {
          fromDay: localDay(new Date(Math.max(book.addedAt, earliest.getTime()))),
          toDay: localDay(today),
        })
          .then((result) => {
            if (disposed) return;
            const history = result?.books.find((row) => row.bookId === book.id);
            if (history) tracker.seed(history.activeMs, history.chars, history.charsPerMin);
          })
          .catch(report);
      }
      const measuredSource = source;
      if (book.format === 'epub')
        void (async () => {
          const counts: number[] = [];
          const anchors = planTocAnchors(measuredSource, measuredSource.toc);
          const offsets = new Map<string, number>();
          try {
            for (const [i, section] of measuredSource.sections.entries()) {
              if (disposed || source !== measuredSource) return;
              const doc = await section.createDocument();
              const text = buildSectionText(doc);
              counts.push(text.total);
              readTocOffsets(anchors, i, doc, text, offsets); // t32u: where each #fragment entry starts
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
          } catch (e) {
            if (!disposed && source === measuredSource) setTocBook(tocBookInfo(measuredSource, 'epub'));
            throw e;
          }
          if (disposed || source !== measuredSource) return;
          sectionChars = counts;
          setTocBook(tocBookInfo(measuredSource, 'epub', { chars: counts, offsets }));
          if (book.format === 'epub')
            await invoke('book_set_total_chars', {
              bookId: book.id,
              totalChars: counts.reduce((a, b) => a + b, 0),
            });
          if (!disposed && renderer) {
            const loc = exactPosition(renderer.getLocator());
            tracker.relocate(loc, 0, true);
            setPosition(loc);
          }
        })().catch(report);
      applyTxt.current = async (patch) => {
        if (!ready || disposed) throw new Error('Reader is still opening');
        await save();
        const at = renderer!.getLocator();
        const prepared = patch
          ? await prepareTxtPreferences(book.id, patch)
          : { manifest: await invoke('txt_prepare', { bookId: book.id }) };
        if (disposed) return;
        // Capture once more: reading may have continued while preparation was in flight.
        const latest = renderer?.getLocator() ?? at;
        ready = false;
        scroller?.stop();
        stopRendererEvents();
        renderer?.destroy();
        source?.destroy();
        manifest = prepared.manifest;
        sectionChars = manifest.sections.map((section) => section.chars);
        source = txtSource(manifest, { title: book.title });
        setChapters(sectionChapterLabels(source));
        setToc(source.toc);
        setTocBook(tocBookInfo(source, book.format));
        await mountRenderer(latest);
      };
      let styleWrites = Promise.resolve();
      let txtSettings = JSON.stringify(useSettings.getState().settings.txt);
      stops.push(
        useSettings.subscribe((next, previous) => {
          if (disposed) return;
          const nextTxt = JSON.stringify(next.settings.txt);
          if (book.format === 'txt' && nextTxt !== txtSettings) {
            txtSettings = nextTxt;
            styleWrites = styleWrites
              .then(async () => {
                await flushSettings();
                if (!disposed) await applyTxt.current?.();
              })
              .catch(report);
          }
          if (!ready) return;
          if (auto.current) auto.current.settings = next.settings.autoscroll;
          if (next.settings.layout.minSpreadWidthPx !== previous.settings.layout.minSpreadWidthPx)
            renderer!.setMinSpreadWidth(next.settings.layout.minSpreadWidthPx);
          if (JSON.stringify(next.settings.scroll) !== JSON.stringify(previous.settings.scroll)) {
            scrollSettings = next.settings.scroll;
            scroller!.settings = scrollSettings;
            renderer!.setPageOverlapLines(scrollSettings.pageOverlapLines);
          }
          if (
            next.settings.reader.pagesPerView !== pagesPerView ||
            next.settings.reader.flow !== flow
          ) {
            styleWrites = styleWrites
              .then(async () => {
                if (
                  !disposed &&
                  (useSettings.getState().settings.reader.pagesPerView !== pagesPerView ||
                    useSettings.getState().settings.reader.flow !== flow)
                )
                  await replaceLayout();
              })
              .catch(report);
          } else if (
            JSON.stringify(next.effectiveStyle) !== JSON.stringify(previous.effectiveStyle) ||
            next.settings.epub.styleOverride !== previous.settings.epub.styleOverride
          ) {
            const compiled = compileStyle(next.effectiveStyle, {
              styleOverride: next.settings.epub.styleOverride,
              format: book.format,
            });
            const target = renderer;
            styleWrites = styleWrites
              .then(async () => {
                if (!disposed && ready && target === renderer) await target?.setStyle(compiled);
              })
              .catch(report);
          }
        }),
      );
      const motionChanged = () => {
        scroller?.setReducedMotion(motionQuery.matches);
        auto.current?.setReducedMotion(motionQuery.matches);
        renderer?.cancelScrollAnimation();
      };
      motionQuery.addEventListener('change', motionChanged);
      stops.push(() => motionQuery.removeEventListener('change', motionChanged));
      stops.push(
        installKeyRouter(window, {
          bindings: () => useSettings.getState().settings.keybindings,
          scopes: () =>
            suspendedRef.current
              ? []
              : auto.current?.state !== 'off'
                ? ['reader.autoscroll', 'reader']
                : ['reader'],
          handle,
          stop: () => {
            scroller?.stop();
            renderer?.cancelScrollAnimation();
          },
        }),
      );
      const manual = () => auto.current?.pause();
      const blur = () => {
        if (!document.hasFocus() && useSettings.getState().settings.autoscroll.pauseOnBlur)
          manual();
      };
      const visibility = () => {
        if (document.hidden) manual();
      };
      const manualKey = (event: KeyboardEvent) => {
        if (
          !event.defaultPrevented &&
          !event.isComposing &&
          !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)
        )
          manual();
      };
      window.addEventListener('keydown', manualKey);
      const overlays = new MutationObserver(() => {
        if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]'))
          manual();
      });
      overlays.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['role', 'data-open'],
      });
      host.current?.addEventListener('reader-manual-input', manual);
      host.current?.addEventListener('pointerdown', manual);
      host.current?.addEventListener('touchstart', manual);
      window.addEventListener('blur', blur);
      document.addEventListener('visibilitychange', visibility);
      stops.push(() => {
        overlays.disconnect();
        host.current?.removeEventListener('reader-manual-input', manual);
        host.current?.removeEventListener('pointerdown', manual);
        host.current?.removeEventListener('touchstart', manual);
        window.removeEventListener('blur', blur);
        window.removeEventListener('keydown', manualKey);
        document.removeEventListener('visibilitychange', visibility);
      });
      const wheel = (e: WheelEvent) => {
        if (suspendedRef.current) return;
        auto.current?.pause();
        scroller?.stop();
        renderer?.cancelScrollAnimation();
        if (e.ctrlKey && e.deltaY) {
          e.preventDefault();
          changeFont(currentStyle().font.size + (e.deltaY < 0 ? 1 : -1));
        }
      };
      window.addEventListener('wheel', wheel, { passive: false });
      stops.push(() => window.removeEventListener('wheel', wheel));
      stops.push(
        subscribeReadingPause(() => {
          tracker.visibility(false);
          void tracker.flush().catch(report);
          auto.current?.pause();
          scroller?.stop();
          renderer?.cancelScrollAnimation();
        }),
      );
    })().catch(report);
    return () => {
      statsVisibility.current = () => undefined;
      tracker.visibility(false);
      disposed = true;
      auto.current?.stop();
      auto.current = null;
      applyTxt.current = null;
      navigate.current = () => undefined;
      toggleBookmark.current = () => undefined;
      deleteBookmark.current = () => undefined;
      if (saveRef.current === save) saveRef.current = null;
      void save().catch(console.warn);
      stops.forEach((stop) => stop());
      stopRendererEvents();
      scroller?.stop();
      renderer?.destroy();
      source?.destroy();
    };
  }, [book, onBack, onQuit, saveRef, showSidebar, closePanel, changeAppearance]);
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
  const goBack = useCallback(() => {
    void saveRef
      .current?.()
      .then(onBack)
      .catch((e: unknown) => setError(String(e)));
  }, [saveRef, onBack]);
  const mountShift = shiftStyle(winW, sidebar.open && pushMode, appearance.open);
  const toggleAppearance = () => changeAppearance(false);
  const setPages = (pages: 1 | 2) =>
    useSettings.getState().setReader({ reader: { pagesPerView: pages } });
  // t32u: the TOC entry containing the position (several chapters can share one spine section).
  // While the section's entries cannot be told apart yet (offsets pending) show no chapter rather
  // than the section's first entry.
  const currentToc = useMemo(() => {
    if (!position) return null;
    const r = classifyToc(tocSpans, position);
    return { unsure: r.unsure === true, label: r.currentKey ? tocLabelAt(toc, r.currentKey) : null };
  }, [position, tocSpans, toc]);
  const chapter =
    position && !currentToc?.unsure
      ? (currentToc?.label ?? chapters[position.sectionIndex] ?? `Section ${position.sectionIndex + 1}`)
      : undefined;
  return (
    <ReaderChrome
      autoHideDelayMs={chromeDelay}
      title={<ReaderTitle book={title} chapter={chapter} />}
      theme={theme}
      pinned={pinned}
      onPinnedChange={setPinned}
      keyboardPin={false}
      onMenusClosed={() => host.current?.focus({ preventScroll: true })}
      onSurfacePress={closeAppearanceOnPress}
      menuOpen={appearance.open || sidebar.open || txtMode !== null}
      sidebar={{ open: sidebar.open, onToggle: () => showSidebar('contents', false, true) }}
      actions={
        <IconButton label="Appearance" action="appearance.toggle" onClick={toggleAppearance}>
          <ALargeSmall size={20} strokeWidth={1.5} aria-hidden />
        </IconButton>
      }
      layout={{
        pagesPerView: pagesSetting === 2 ? 2 : 1,
        onPagesPerViewChange: setPages,
        flow: flowSetting,
        onFlowChange: (flow) => useSettings.getState().setReader({ reader: { flow } }),
        effectivePagesPerView: effectivePages,
      }}
      commands={[
        ...(book.format === 'txt'
          ? [
              { label: 'Text Encoding…', onSelect: () => setTxtMode('encoding') },
              { label: 'Chapter Detection…', onSelect: () => setTxtMode('chapters') },
            ]
          : []),
        { label: 'Settings', shortcut: sc('settings.open'), onSelect: () => onSettings?.() },
        { label: 'Appearance', shortcut: sc('appearance.toggle'), onSelect: toggleAppearance },
        { label: 'Contents', shortcut: sc('toc.toggle'), onSelect: () => showSidebar('contents', false, true) },
        { label: 'Bookmarks', shortcut: sc('bookmarks.show'), onSelect: () => showSidebar('bookmarks', false) },
        { label: 'Add Bookmark', shortcut: sc('bookmark.toggle'), onSelect: () => toggleBookmark.current() },
        {
          label: flowSetting === 'scroll' ? 'Paged' : 'Scroll',
          shortcut: sc('layout.toggleFlow'),
          onSelect: () =>
            useSettings
              .getState()
              .setReader({ reader: { flow: flowSetting === 'scroll' ? 'paged' : 'scroll' } }),
        },
        {
          label: pagesSetting === 2 ? 'One Page' : 'Two Pages',
          shortcut: sc('layout.togglePages'),
          onSelect: () => setPages(pagesSetting === 2 ? 1 : 2),
        },
        {
          label: windowState?.fullscreen ? 'Exit Full Screen' : 'Full Screen',
          shortcut: sc('fullscreen.toggle'),
          onSelect: () =>
            void invoke('window_set_fullscreen', { fullscreen: !windowState?.fullscreen }).catch(
              (e: unknown) => setError(String(e)),
            ),
        },
        { type: 'separator' },
        { label: 'Back to Library', shortcut: sc('book.close'), onSelect: goBack },
      ]}
      onClose={onQuit}
      leading={
        <IconButton label="Back" action="book.close" onClick={goBack}>
          <ArrowLeftIcon />
        </IconButton>
      }
      readout={readout}
      footer={
        <ReaderFooter
          {...estimates}
          chapter={chapter}
          progress={position?.progress}
          notice={notice}
        />
      }
    >
      <div
        ref={host}
        className="reader-mount"
        data-reading-surface=""
        tabIndex={-1}
        style={mountShift}
      />
      <SizeLabel px={sizeLabel.px} stamp={sizeLabel.stamp} />
      {!suspended &&
        !sidebar.open &&
        !appearance.open &&
        !txtMode &&
        marks.map((mark) => (
          <div key={mark.id} style={{ position: 'absolute', left: mark.left, top: mark.top }}>
            <BookmarkMark onClick={() => deleteBookmark.current(mark.id)} />
          </div>
        ))}
      {autoStatus.visible && (
        <AutoScrollPill
          active={true}
          paused={autoStatus.state === 'paused'}
          speedLabel={
            autoStatus.speed.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' px/s'
          }
        />
      )}
      <TocSidebar
        open={sidebar.open}
        mode={sidebarModeFor(winW)}
        animate={sidebar.animate}
        tab={sidebar.tab}
        onTabChange={(tab) => setSidebar((s) => ({ ...s, tab }))}
        toc={toc}
        currentHref={currentHref}
        tocBook={tocBook}
        position={position ?? null}
        readKeys={readKeys}
        onNavigate={(href) => navigate.current({ href })}
        bookmarks={bookmarks.map((b) => ({
          id: b.id,
          label: b.chapterTitle ?? 'Bookmark',
          excerpt: b.snippet ?? '',
          progress: b.progress,
          createdAt: new Date(b.createdAt).toISOString(),
        }))}
        onBookmarkOpen={(id) => {
          const row = bookmarks.find((b) => b.id === id);
          if (row) navigate.current(row.locator);
        }}
        onBookmarkDelete={(id) => deleteBookmark.current(id)}
        onClose={() => closePanel(true)}
      />
      {txtMode && (
        <TxtSettingsDialogs
          target={{ bookId: book.id, mode: txtMode }}
          onClose={() => setTxtMode(null)}
          onApply={async (patch) => {
            if (!applyTxt.current) throw new Error('Reader is still opening');
            await applyTxt.current(patch);
          }}
        />
      )}
      <AppearancePanel
        open={appearance.open}
        instant={appearance.byKey}
        onClose={() => {
          panels.current = panels.current.filter((p) => p !== 'appearance');
          setAppearance({ open: false, byKey: false });
        }}
      />
      {error && (
        <div className="reader-error" role="alert">
          {error}
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      )}
    </ReaderChrome>
  );
}

/** t24u: what the TOC sidebar needs to classify chapters as read / current / unread. */
function tocBookInfo(
  source: BookSource,
  format: 'epub' | 'txt',
  extra: Pick<TocBookInfo, 'chars' | 'offsets' | 'pending'> = {},
): TocBookInfo {
  return {
    resolve: (href) => source.resolveHref(href)?.index ?? null,
    sizes: source.sections.map((s) => s.size),
    format,
    ...extra,
  };
}
