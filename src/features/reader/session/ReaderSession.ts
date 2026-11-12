/**
 * ReaderSession (#2): everything that happens while one book is open, without React. It owns
 * opening the book, the renderer and its remounts (layout swap, TXT re-split; one transition queue,
 * N6/N9), the reading position and its one progress (N2: the renderer's locator, char basis via the
 * locator bridge, 1 at the end, N1), position saving, reading stats, bookmarks, chapter visit
 * memory, the reader's keys and the reader panels. ReaderView subscribes to its state and draws it.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ActionId, Bookmark, BookOpenResult, BookRecord, EpubSectionChars, Locator, TxtManifest, TxtPrefsPatch } from '@contract/types';
import { toast } from 'sonner';
import { epubSource } from '../../../engine/book/epubSource';
import { txtSource, createTxtLocatorBridge } from '../../../engine/book/txtSource';
import type { BookSource, TocItem } from '../../../engine/book/BookSource';
import { createLocatorBridge, PositionPersistence } from '../../../engine/locator';
import { createRenderer, type ScrollRenderer } from '../../../engine/renderers/createRenderer';
import type { GoToTarget } from '../../../engine/renderers/Renderer';
import { measureEpubSections } from '../../../engine/book/epubMeasurements';
import { compileStyle } from '../../../engine/style/compileStyle';
import { installKeyRouter, isActivationKey, keyOwner } from '../../../engine/input/keyRouter';
import type { Scope } from '../../../engine/input/keymap';
import { AutoScroller, type AutoScrollState } from '../../../engine/input/autoScroller';
import { SmoothScroller } from '../../../engine/input/smoothScroller';
import { pauseReading, subscribeReadingPause } from '../../../engine/input/pauseBus';
import { SessionTracker, readingEstimates } from '../../../engine/sessionTracker';
import { sortBookmarks } from '../../../engine/bookmarks';
import { invoke, isAppError } from '../../../ipc/commands';
import { listen } from '../../../ipc/events';
import { errorCopy } from '../../../ipc/errorCopy';
import { useSettings, loadSettings, flushSettings } from '../../../state/settingsStore';
import { overlays } from '../../../state/overlayStore';
import { windowState } from '../../../ui/useWindowState';
import { prepareTxtPreferences } from '../../txt/txtSettings';
import {
  buildTocSpans,
  chapterKeyFor,
  classifyToc,
  tocLabelAt,
  tocOrdinal,
  txtChapterKey,
  type TocBookInfo,
  type TocReading,
  type TocSpan,
} from '../../toc/tocModel';
import { ChapterMemory, type ChapterReadApi } from '../../toc/chapterMemory';
import { sectionChapterLabels } from '../ReaderFooter.labels';
import { TransitionQueue } from './transitionQueue';

export type Estimates = ReturnType<typeof readingEstimates>;
export interface Mark {
  id: string;
  left: number;
  top: number;
}
export type SidebarTab = 'contents' | 'bookmarks';

export interface ReaderState {
  title: string;
  /** The renderer's locator: the one position and progress (footer, readout, TOC, bookmarks). */
  position: Locator | null;
  /** Chapter title of the position (TOC entry, else the section's label); null while unsure. */
  chapter: string | null;
  toc: TocItem[];
  spans: readonly TocSpan[];
  /** The one current-chapter reading (#14), passed to the TOC, the readout and the visit memory. */
  reading: TocReading;
  /** Ordinal of the current entry (footer readout); null when none. */
  ordinal: { index: number; count: number } | null;
  /** true while a cold/partial EPUB cache is measured behind the mounted text. */
  measuring: boolean;
  readKeys: ReadonlySet<string>;
  bookmarks: readonly Bookmark[];
  marks: readonly Mark[];
  estimates: Estimates;
  effectivePages: 1 | 2;
  auto: { state: AutoScrollState; speed: number; visible: boolean };
  sizeLabel: { px: number | null; stamp: number };
  sidebar: { open: boolean; animate: boolean; tab: SidebarTab };
  appearance: { open: boolean; byKey: boolean };
  pinned: boolean;
  /** Open/mount failure (the only fatal panel, #10). User copy, never a backend message. */
  fatal: string | null;
}

export interface ReaderSessionCallbacks {
  onBack(): void;
}

const NONE: TocReading = { currentKey: null, currentHref: null, currentChapterKey: null, percent: null };
/** Every input that counts as reading activity (#3: added and removed from one list). */
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
const SIDEBAR = 'reader.sidebar';
const APPEARANCE = 'reader.appearance';

const chapterReadApi: ChapterReadApi = {
  get: async (bookId) => (await invoke('chapters_read_get', { bookId })).chapterKeys,
  mark: async (bookId, chapterKey) => (await invoke('chapter_mark_read', { bookId, chapterKey })).chapterKeys,
};

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) =>
  a.length === b.length && a.every((m, i) => m.id === b[i]!.id && m.left === b[i]!.left && m.top === b[i]!.top);
const sameEstimates = (a: Estimates, b: Estimates) =>
  a.speedLabel === b.speedLabel && a.timeLeftChapter === b.timeLeftChapter && a.timeLeftBook === b.timeLeftBook;

export class ReaderSession {
  readonly book: BookRecord;
  #cb: ReaderSessionCallbacks;
  #openedData?: BookOpenResult;
  #host: HTMLElement;
  #state: ReaderState;
  #listeners = new Set<() => void>();
  #queue = new TransitionQueue();
  #stops: (() => void)[] = [];
  #rendererStops: (() => void)[] = [];
  #disposed = false;
  #ready = false;
  #suspended = false;
  #renderer: ScrollRenderer | null = null;
  #layout = { flow: 'scroll' as 'scroll' | 'paged', pages: 1 as 1 | 2 };
  #scroller: SmoothScroller | null = null;
  #auto: AutoScroller | null = null;
  #source: BookSource | null = null;
  #manifest: TxtManifest | null = null;
  /** Stable body-text progress weights: cached/measured EPUB chars, or TXT manifest chars. */
  #sectionChars: number[] | null = null;
  #tocBook: TocBookInfo | null = null;
  /** Chapter label per section (title fallback, bookmark titles). */
  #labels: (string | null)[] = [];
  #persistence: PositionPersistence | null = null;
  /** Last live locator: React detaches the iframes before cleanup, the final save must not read them. */
  #lastLocator: Locator | null = null;
  #tracker: SessionTracker;
  #memory: ChapterMemory;
  #jump = false;
  #bossHidden = false;
  #focused = true;
  #bookmarkWrites = Promise.resolve();
  #txtRevision = 0;
  #txtApplied = 0;
  #styleDirty = false;
  #marksFrame = 0;
  #pillTimer: ReturnType<typeof setTimeout> | undefined;
  #motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(book: BookRecord, host: HTMLElement, callbacks: ReaderSessionCallbacks, openedData?: BookOpenResult) {
    this.book = book;
    this.#openedData = openedData;
    this.#host = host;
    this.#cb = callbacks;
    const stats = useSettings.getState().settings.stats;
    this.#tracker = new SessionTracker(book.id, stats.idleTimeoutSec * 1000,
      (session) => invoke('stats_session_save', { session }), Date.now, this.#notify,
    );
    this.#tracker.configure(stats.enabled, stats.idleTimeoutSec * 1000);
    this.#tracker.visibility(false);
    // A failed mark is retried on the next visit; nothing for the reader to act on.
    this.#memory = new ChapterMemory(book.id, chapterReadApi, undefined, (e) => console.warn('[reader] chapter memory', e));
    this.#state = {
      title: book.title,
      position: null,
      chapter: null,
      toc: [],
      spans: [],
      reading: NONE,
      ordinal: null,
      measuring: false,
      readKeys: this.#memory.getSnapshot(),
      bookmarks: [],
      marks: [],
      estimates: {},
      effectivePages: 1,
      auto: { state: 'off', speed: useSettings.getState().settings.autoscroll.speed, visible: false },
      sizeLabel: { px: null, stamp: 0 },
      sidebar: { open: false, animate: false, tab: 'contents' },
      appearance: { open: false, byKey: false },
      pinned: false,
      fatal: null,
    };
  }

  // ───────────── store ─────────────

  getState = (): ReaderState => this.#state;
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  };
  #set(patch: Partial<ReaderState>): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch };
    this.#listeners.forEach((fn) => fn());
  }
  /** Transient failure: a toast with user copy; reading goes on (#10). */
  #notify = (e: unknown): void => {
    if (this.#disposed || this.#state.fatal) return;
    console.warn('[reader]', e);
    toast.error(errorCopy(e), { id: isAppError(e) ? e.code : 'INTERNAL' });
  };
  /** Open/mount failure: the fatal panel (#10). */
  #fail = (e: unknown): void => {
    console.warn('[reader] open failed', e);
    this.#set({ fatal: errorCopy(e) });
  };

  // ───────────── lifecycle ─────────────

  /** Key router first (#19: Ctrl+W and the rest work while the book opens), then open. */
  start(): void {
    this.#listen();
    void this.#queue.run(() => this.#open()).catch(this.#fail);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#tracker.visibility(false);
    void this.save().catch(console.warn);
    this.#disposed = true;
    this.#queue.close();
    overlays.close(SIDEBAR);
    overlays.close(APPEARANCE);
    this.#memory.dispose();
    this.#auto?.stop();
    clearTimeout(this.#pillTimer);
    cancelAnimationFrame(this.#marksFrame);
    this.#stops.forEach((stop) => stop());
    this.#stops = [];
    this.#teardownRenderer();
    this.#source?.destroy();
    this.#listeners.clear();
  }

  /** Stop motion, then flush settings, stats and the last position. */
  async save(): Promise<void> {
    this.#stopMotion();
    this.#capture();
    await Promise.all([
      flushSettings(),
      this.#tracker.flush(),
      this.#persistence && this.#lastLocator ? this.#persistence.flush(this.#lastLocator) : undefined,
    ]);
  }

  back = (): void => {
    void this.save()
      .then(() => this.#cb.onBack())
      .catch(this.#notify);
  };

  setSuspended(suspended: boolean): void {
    if (this.#suspended === suspended) return;
    this.#suspended = suspended;
    if (suspended) this.#auto?.pause();
    this.#visibility();
    this.#visitChapter();
    if (!suspended) this.#applyTxtIfDirty(); // N9: a global TXT change made in Settings, once
  }

  // ───────────── open, mount, transitions ─────────────

  async #open(): Promise<void> {
    await loadSettings();
    if (this.#disposed) return;
    const settings = useSettings.getState().settings;
    if (settings.ui.tocOpen) this.#openSidebar('contents', true);
    this.#persistence = new PositionPersistence(this.book.id, undefined, this.#notify);
    this.#memory.start();
    this.#stops.push(this.#memory.subscribe(() => this.#set({ readKeys: this.#memory.getSnapshot() })));
    const opened = this.#openedData ?? await invoke('book_open', { bookId: this.book.id });
    if (this.#disposed) return;
    const seed = opened.statsSeed;
    if (settings.stats.enabled) this.#tracker.seed(seed.activeMs, seed.chars, seed.charsPerMin);
    const at = await this.#persistence.restore();
    if (this.#disposed) return;
    let measurement: { source: BookSource; cached: EpubSectionChars } | undefined;
    if (this.book.format === 'txt') {
      const manifest = await invoke('txt_prepare', { bookId: this.book.id });
      if (this.#disposed) return;
      this.#useSource(txtSource(manifest, { title: this.book.title }), manifest);
    } else {
      const source = await epubSource(convertFileSrc(this.book.filePath));
      if (this.#disposed) return source.destroy();
      this.#useSource(source, null);
      this.#setPosition(at ?? { sectionIndex: 0, charOffset: 0, globalCharOffset: 0, cfi: null, progress: 0, snippet: '' });
      const cached = opened.epubMetrics!;
      const missing = cached.sectionChars.length !== source.sections.length || cached.sectionChars.some((n) => n === null);
      if (missing) measurement = { source, cached };
      else {
        this.#sectionChars = cached.sectionChars.map((n) => n ?? 0);
        this.#setTocBook({ offsets: new Map(Object.entries(cached.tocFragmentOffsets)) });
      }
    }
    this.#setBookmarks((await invoke('bookmarks_list', { bookId: this.book.id })) ?? []);
    if (this.#disposed) return;
    await this.#mount(at ?? null);
    if (this.#disposed) return;
    if (measurement) void this.#measure(measurement.source, measurement.cached)
      .catch((e) => console.warn('[reader] EPUB measurement', e));
    this.#applyTxtIfDirty();
  }

  /** Refine progress in place: the bridge reads the new weights without remounting or navigating. */
  async #measure(source: BookSource, cached: EpubSectionChars): Promise<void> {
    const cancelled = () => this.#disposed || this.#source !== source;
    const metrics = await measureEpubSections(source, cached,
      (e) => console.warn('[reader] EPUB section measurement', e), cancelled);
    if (!metrics || cancelled()) return;
    this.#sectionChars = metrics.sectionChars.map((n) => n ?? 0);
    this.#setTocBook({ offsets: new Map(Object.entries(metrics.tocFragmentOffsets)) });
    // Re-read the live position with real weights. Treat the basis change as a jump for stats.
    if (this.#ready && this.#renderer) this.#relocated(this.#renderer.getLocator(), true);
    this.#tick();
    void invoke('book_set_section_chars', { bookId: this.book.id, metrics })
      .catch((e) => console.warn('[reader] save EPUB measurements', e));
  }

  /** A new source: title/TOC and byte-size progress placeholders until a cold EPUB is measured. */
  #useSource(source: BookSource, manifest: TxtManifest | null): void {
    this.#source?.destroy();
    this.#source = source;
    this.#manifest = manifest;
    this.#sectionChars = manifest ? manifest.sections.map((s) => s.chars) : null;
    this.#setTocBook({ pending: !manifest });
    this.#set({ title: source.metadata.title || this.book.title, toc: source.toc });
  }

  #setTocBook(extra: Pick<TocBookInfo, 'offsets' | 'pending'>): void {
    const source = this.#source!;
    const manifest = this.#manifest;
    this.#tocBook = {
      resolve: (href) => source.resolveHref(href)?.index ?? null,
      weights: this.#sectionChars ?? source.sections.map((s) => s.size),
      chapterKey: manifest
        ? (start) => txtChapterKey(manifest.encoding, manifest.sections[start]?.startChar ?? start)
        : chapterKeyFor,
      ...extra,
    };
    this.#labels = sectionChapterLabels(source);
    const spans = buildTocSpans(source.toc, this.#tocBook);
    this.#set({ spans, measuring: !!extra.pending });
    this.#setPosition(this.#state.position);
  }

  async #mount(at: Locator | null): Promise<void> {
    const settings = useSettings.getState().settings;
    const style = useSettings.getState().effectiveStyle;
    this.#layout = { flow: settings.reader.flow, pages: settings.reader.pagesPerView === 2 ? 2 : 1 };
    const source = this.#source!;
    const { renderer } = createRenderer(
      { flow: this.#layout.flow, pagesPerView: this.#layout.pages },
      {
        locatorBridge: this.#manifest
          ? createTxtLocatorBridge(this.#manifest)
          : createLocatorBridge(source.sections.length, () => this.#sectionChars),
        pageOverlapLines: settings.scroll.pageOverlapLines,
        minSpreadWidthPx: settings.layout.minSpreadWidthPx,
      },
    );
    this.#renderer = renderer;
    this.#styleDirty = false;
    this.#rendererStops = [
      renderer.on('relocate', ({ locator, reason }) => this.#relocated(locator, reason !== 'scroll')),
      renderer.on('load', this.#scheduleMarks),
      renderer.on('spread', ({ pagesPerView }) => this.#set({ effectivePages: pagesPerView })),
    ];
    try {
      await renderer.mount(
        this.#host, source,
        compileStyle(style, { styleOverride: settings.epub.styleOverride, format: this.book.format }),
        at ?? undefined,
      );
    } catch (e) {
      this.#teardownRenderer();
      this.#fail(e);
      throw e;
    }
    if (this.#disposed || this.#renderer !== renderer) return;
    const latest = useSettings.getState().settings;
    renderer.setMinSpreadWidth(latest.layout.minSpreadWidthPx);
    if (renderer.kind === 'continuous') renderer.setPageOverlapLines(latest.scroll.pageOverlapLines);
    this.#scroller = new SmoothScroller(renderer, latest.scroll, undefined, this.#motionQuery.matches);
    this.#auto = new AutoScroller(renderer, latest.autoscroll, this.#motionQuery.matches, (state) =>
      this.#autoChanged(state),
    );
    this.#ready = true;
    this.#set({ effectivePages: renderer.getEffectivePagesPerView() });
    this.#visibility();
    this.#scheduleMarks();
    // Settings that changed while mounting are applied by the queued transitions they scheduled.
  }

  #teardownRenderer(): void {
    this.#ready = false;
    this.#auto?.stop();
    this.#auto = null;
    this.#scroller?.stop();
    this.#scroller = null;
    this.#rendererStops.forEach((stop) => stop());
    this.#rendererStops = [];
    this.#renderer?.destroy();
    this.#renderer = null;
  }

  /** Current live locator (kept in #lastLocator for the final save). */
  #capture(): Locator | null {
    if (this.#ready && this.#renderer && this.#host.isConnected) this.#lastLocator = this.#renderer.getLocator();
    return this.#lastLocator;
  }

  /** Remount with the latest layout (one page / filmstrip / flow), keeping the position. */
  async #applyLayout(): Promise<void> {
    const s = useSettings.getState().settings.reader;
    if (!this.#renderer || (s.flow === this.#layout.flow && (s.pagesPerView === 2 ? 2 : 1) === this.#layout.pages))
      return;
    this.#stopMotion();
    const at = this.#capture();
    if (at) await this.#persistence?.flush(at).catch(this.#notify);
    if (this.#disposed) return;
    this.#teardownRenderer();
    await this.#mount(at);
  }

  /** TXT re-split (encoding / chapter rules), from the book's dialog or a global TXT setting. */
  async #resplit(patch?: TxtPrefsPatch): Promise<boolean> {
    if (!this.#renderer) return false;
    await this.save();
    const manifest = patch
      ? (await prepareTxtPreferences(this.book.id, patch)).manifest
      : await invoke('txt_prepare', { bookId: this.book.id });
    if (this.#disposed) return false;
    // Reading may have continued while the text was prepared: take the latest position.
    const at = this.#capture();
    this.#teardownRenderer();
    this.#useSource(txtSource(manifest, { title: this.book.title }), manifest);
    await this.#mount(at);
    return !this.#disposed && this.#ready;
  }

  /** The book's Text Encoding / Chapter Detection dialog. Rejects for the dialog to show. */
  applyTxtPrefs(patch: TxtPrefsPatch): Promise<void> {
    return this.#queue.run(() => this.#resplit(patch)).then(() => undefined);
  }

  /** N9: a global TXT setting changed: mark dirty, re-split once (never while Settings is open). */
  #applyTxtIfDirty(): void {
    if (this.#txtApplied === this.#txtRevision || this.#suspended || this.book.format !== 'txt') return;
    void this.#queue
      .run(async () => {
        if (this.#txtApplied === this.#txtRevision || this.#suspended) return;
        await flushSettings();
        const revision = this.#txtRevision;
        if (await this.#resplit()) this.#txtApplied = revision;
      })
      .catch(this.#notify);
  }

  #applyStyle(): void {
    this.#styleDirty = true;
    void this.#queue
      .run(async () => {
        if (!this.#styleDirty || !this.#renderer || !this.#ready) return;
        this.#styleDirty = false;
        const s = useSettings.getState();
        await this.#renderer.setStyle(
          compileStyle(s.effectiveStyle, { styleOverride: s.settings.epub.styleOverride, format: this.book.format }),
        );
      })
      .catch(this.#notify);
  }

  // Position and chapter state.

  #relocated(locator: Locator, jump: boolean): void {
    if (this.#disposed || !this.#host.isConnected) return;
    this.#lastLocator = locator;
    const style = compileStyle(useSettings.getState().effectiveStyle);
    const viewport = this.#renderer?.getViewportHeight() ?? 0;
    const screenChars =
      Math.max(1, viewport / style.lineHeightPx) * Math.max(1, (this.#host.clientWidth || 800) / style.fontSizePx);
    this.#tracker.relocate(locator, screenChars, this.#jump || jump || !this.#ready || this.#state.measuring);
    this.#jump = false;
    this.#scheduleMarks();
    this.#setPosition(locator);
    if (this.#ready) this.#persistence?.schedule(locator);
  }

  /** The position and everything derived from it, computed once (#14). */
  #setPosition(position: Locator | null): void {
    const spans = this.#state.spans;
    const reading = position ? classifyToc(spans, position) : NONE;
    const label = reading.currentKey ? tocLabelAt(this.#state.toc, reading.currentKey) : null;
    const chapter =
      position ? (label ?? this.#labels[position.sectionIndex] ?? `Section ${position.sectionIndex + 1}`) : null;
    this.#set({ position, reading, chapter, ordinal: tocOrdinal(spans, reading.currentKey) });
    this.#visitChapter();
  }

  /** Chapter visit memory: the dwell counts only while the text is shown and the chapter is sure. */
  #visitChapter(): void {
    const { reading, measuring } = this.#state;
    this.#memory.visit(this.#suspended || measuring ? null : reading.currentChapterKey);
  }

  navigate = (target: GoToTarget): void => {
    if (!this.#ready || !this.#renderer) return;
    this.#stopMotion();
    this.#jump = true;
    void this.#renderer.goTo(target).catch(this.#notify);
  };

  navigateHref = (href: string): void => this.navigate({ href });

  openBookmark = (id: string): void => {
    const row = this.#state.bookmarks.find((b) => b.id === id);
    if (row) this.navigate(row.locator);
  };

  // ───────────── bookmarks (N8: the locator the footer shows) ─────────────

  #setBookmarks(rows: Bookmark[]): void {
    this.#set({ bookmarks: sortBookmarks(rows) });
    this.#scheduleMarks();
  }

  #enqueueBookmark(write: () => Promise<void>): void {
    this.#bookmarkWrites = this.#bookmarkWrites
      .then(async () => {
        if (!this.#disposed) await write();
      })
      .catch(this.#notify);
  }

  async #addBookmark(args: Pick<Bookmark, 'locator' | 'chapterTitle' | 'snippet'>): Promise<void> {
    const added = await invoke('bookmark_add', { bookId: this.book.id, ...args });
    this.#setBookmarks([...this.#state.bookmarks, added]);
  }

  async #removeBookmark(row: Bookmark): Promise<void> {
    await invoke('bookmark_remove', { bookmarkId: row.id });
    this.#setBookmarks(this.#state.bookmarks.filter((b) => b.id !== row.id));
    if (this.#disposed) return;
    toast('Bookmark deleted', {
      action: {
        label: 'Undo',
        onClick: () =>
          this.#enqueueBookmark(() =>
            this.#addBookmark({ locator: row.locator, chapterTitle: row.chapterTitle, snippet: row.snippet }),
          ),
      },
    });
  }

  deleteBookmark = (id: string): void =>
    this.#enqueueBookmark(async () => {
      const row = this.#state.bookmarks.find((b) => b.id === id);
      if (row) await this.#removeBookmark(row);
    });

  toggleBookmark = (): void => {
    if (!this.#ready || !this.#renderer) return;
    const locator = this.#renderer.getLocator();
    this.#enqueueBookmark(async () => {
      const row = this.#state.bookmarks.find((b) =>
        locator.globalCharOffset !== null && b.locator.globalCharOffset !== null
          ? locator.globalCharOffset === b.locator.globalCharOffset
          : locator.sectionIndex === b.locator.sectionIndex && locator.charOffset === b.locator.charOffset,
      );
      if (row) await this.#removeBookmark(row);
      else
        await this.#addBookmark({
          locator,
          chapterTitle: this.#labels[locator.sectionIndex] ?? null,
          snippet: Array.from(locator.snippet).slice(0, 60).join(''),
        });
    });
  };

  /** Margin marks of the bookmarks on screen; published only when they change (#1). */
  #scheduleMarks = (): void => {
    if (this.#marksFrame || this.#disposed) return;
    this.#marksFrame = requestAnimationFrame(() => {
      this.#marksFrame = 0;
      if (this.#disposed) return;
      const bounds = this.#host.getBoundingClientRect();
      const marks = this.#state.bookmarks.flatMap((row) => {
        const rect = this.#renderer?.getLocatorRect(row.locator);
        return rect
          ? [
              {
                id: row.id,
                left: Math.max(bounds.left, rect.marginLeft - 18) - bounds.left,
                top: Math.max(bounds.top, rect.top) - bounds.top,
              },
            ]
          : [];
      });
      if (!sameMarks(marks, this.#state.marks)) this.#set({ marks });
    });
  };

  // ───────────── panels (overlay store, #13) ─────────────

  #openSidebar(tab: SidebarTab, byKey: boolean): void {
    this.#set({ sidebar: { open: true, animate: !byKey, tab } });
    overlays.open({ id: SIDEBAR, kind: 'panel', close: () => this.closeSidebar(true) });
    useSettings.getState().patch({ ui: { tocOpen: true } });
  }

  showSidebar = (tab: SidebarTab, byKey: boolean, toggle = false): void => {
    if (toggle && this.#state.sidebar.open) this.closeSidebar(byKey);
    else if (this.#state.sidebar.open) this.#set({ sidebar: { ...this.#state.sidebar, tab } });
    else this.#openSidebar(tab, byKey);
  };

  setSidebarTab = (tab: SidebarTab): void => this.#set({ sidebar: { ...this.#state.sidebar, tab } });

  closeSidebar = (byKey: boolean): void => {
    overlays.close(SIDEBAR);
    if (!this.#state.sidebar.open) return;
    this.#set({ sidebar: { ...this.#state.sidebar, open: false, animate: !byKey } });
    useSettings.getState().patch({ ui: { tocOpen: false } });
    this.#host.focus({ preventScroll: true }); // the chrome's idle rule can hide the bar again
  };

  toggleAppearance = (byKey: boolean): void => {
    if (this.#state.appearance.open) return this.closeAppearance(byKey);
    this.#set({ appearance: { open: true, byKey } });
    overlays.open({ id: APPEARANCE, kind: 'panel', close: () => this.closeAppearance(true) });
  };

  closeAppearance = (byKey = false): void => {
    overlays.close(APPEARANCE);
    if (!this.#state.appearance.open) return;
    this.#set({ appearance: { open: false, byKey } });
    this.#host.focus({ preventScroll: true });
  };

  /** A press on the reading surface closes the Appearance panel; true = the press is consumed. */
  closeAppearanceOnPress = (): boolean => {
    if (!this.#state.appearance.open) return false;
    this.closeAppearance(false);
    return true;
  };

  setPinned = (pinned: boolean): void => this.#set({ pinned });

  // ───────────── layout, font, window ─────────────

  setFlow = (flow: 'scroll' | 'paged'): void => useSettings.getState().setReader({ reader: { flow } });
  setPages = (pages: 1 | 2): void => useSettings.getState().setReader({ reader: { pagesPerView: pages } });

  #changeFont(size: number): void {
    useSettings.getState().patchStyle({ font: { size } });
    this.#showSize();
  }
  #showSize(): void {
    const s = this.#state.sizeLabel;
    this.#set({ sizeLabel: { px: useSettings.getState().effectiveStyle.font.size, stamp: s.stamp + 1 } });
  }

  toggleFullscreen = (): void => this.#setFullscreen(!windowState.get()?.fullscreen);
  #setFullscreen(fullscreen: boolean): void {
    void invoke('window_set_fullscreen', { fullscreen }).catch(this.#notify);
  }

  // ───────────── input ─────────────

  #stopMotion(): void {
    this.#auto?.pause();
    this.#scroller?.stop();
    if (this.#renderer?.kind === 'continuous') this.#renderer.cancelScrollAnimation();
  }

  /**
   * Key scopes, one rule (G0, #13): Settings or a menu/dialog/popover owns the keyboard (no reader
   * keys). Otherwise the focused element decides: a control that uses the reading keys itself (text
   * field, slider, select, list, menu, tabs, the TOC tree) leaves only the chrome shortcuts; a plain
   * button or link takes only Space/Enter; anywhere else the reading keys work, whether or not a
   * non-modal panel (Contents, Appearance) is open.
   */
  #scopes = (e: KeyboardEvent): Scope[] => {
    if (this.#suspended || overlays.covering()) return [];
    const owner = keyOwner(e.target);
    if (owner === 'entry' || owner === 'navigation' || (owner === 'activator' && isActivationKey(e)))
      return ['panel'];
    return this.#auto && this.#auto.state !== 'off' ? ['reader.autoscroll', 'reader'] : ['reader'];
  };

  /**
   * G0: a pointer click on a chrome button, link, tab or TOC entry hands keyboard focus back to the
   * text, so the reading keys work without another click. Keyboard activation (click detail 0)
   * keeps focus where the user put it; a value control (field, slider, select) keeps it too; a
   * menu, popover or dialog that opened takes focus itself (it is then covering).
   */
  #pointerFocus = (e: MouseEvent): void => {
    if (e.detail === 0 || this.#suspended || overlays.covering()) return;
    const target = e.target as Element | null;
    const owner = keyOwner(target);
    if (owner !== 'navigation' && owner !== 'activator') return;
    if (!target || this.#host.contains(target)) return;
    this.#host.focus({ preventScroll: true });
  };

  /** Escape: the top panel first, else leave fullscreen. It never leaves the book. */
  #dismiss(): void {
    if (!overlays.dismissTop() && windowState.get()?.fullscreen) this.#setFullscreen(false);
  }

  handle = (action: ActionId, phase: 'down' | 'up'): boolean => {
    if (this.#suspended) return false;
    switch (action) {
      // Chrome actions (also while opening and with a panel open).
      case 'book.close':
        if (phase === 'down') this.back();
        return true;
      case 'dismiss':
        if (phase === 'down') this.#dismiss();
        return true;
      case 'toc.toggle':
        if (phase === 'down') this.showSidebar('contents', true, true);
        return true;
      case 'bookmarks.show':
        if (phase === 'down') this.showSidebar('bookmarks', true);
        return true;
      case 'appearance.toggle':
        if (phase === 'down') this.toggleAppearance(true);
        return true;
      case 'chrome.toggle':
        if (phase === 'down') this.setPinned(!this.#state.pinned);
        return true;
      case 'fullscreen.toggle':
        if (phase === 'down') this.toggleFullscreen();
        return true;
      case 'font.increase':
      case 'font.decrease':
        if (phase === 'down')
          this.#changeFont(useSettings.getState().effectiveStyle.font.size + (action === 'font.increase' ? 1 : -1));
        return true;
      case 'font.reset':
        if (phase === 'down') {
          useSettings.getState().resetStyleKey('font.size');
          this.#showSize();
        }
        return true;
    }
    const renderer = this.#renderer;
    const scroller = this.#scroller;
    if (!this.#ready || !renderer || !scroller) return false;
    if (action.startsWith('autoscroll.')) {
      const auto = this.#auto;
      if (phase === 'up' || !auto) return true;
      if (action === 'autoscroll.toggle' && auto.state !== 'off') auto.stop();
      else {
        scroller.stop();
        if (renderer.kind === 'continuous') renderer.cancelScrollAnimation();
        if (action === 'autoscroll.toggle') auto.toggle();
        else if (action === 'autoscroll.pause') auto.togglePause();
        else
          useSettings.getState().patch({
            autoscroll: { speed: auto.adjust(action === 'autoscroll.faster' ? 1 : -1) },
          });
      }
      return true;
    }
    if (phase === 'down') this.#auto?.pause();
    // Page targets (ADR-005): page keys are held like arrows (the filmstrip glides while held).
    const held =
      action === 'scroll.down' ||
      action === 'scroll.up' ||
      (renderer.kind === 'paged' && (action === 'page.next' || action === 'page.prev'));
    if (held) {
      if (renderer.kind === 'continuous') renderer.cancelScrollAnimation();
      const direction = action === 'scroll.down' || action === 'page.next' ? 1 : -1;
      if (phase === 'down') scroller.press(direction);
      else scroller.release(direction);
      return true;
    }
    if (phase === 'up') return true;
    const edge = (index: number, at: 'start' | 'end') => {
      this.#jump = true;
      scroller.stop();
      void renderer.goToSectionEdge(index, at).catch(this.#notify);
    };
    switch (action) {
      case 'bookmark.toggle':
        this.toggleBookmark();
        break;
      case 'layout.toggleFlow':
        this.setFlow(this.#layout.flow === 'scroll' ? 'paged' : 'scroll');
        break;
      case 'layout.togglePages':
        this.setPages(this.#layout.pages === 1 ? 2 : 1);
        break;
      case 'page.next':
      case 'page.prev':
        scroller.stop();
        renderer.page(action === 'page.next' ? 1 : -1);
        break;
      case 'chapter.start':
      case 'chapter.end':
        edge(renderer.getSectionIndex(), action === 'chapter.start' ? 'start' : 'end');
        break;
      case 'book.start':
        edge(0, 'start');
        break;
      case 'book.end':
        edge(renderer.sectionCount - 1, 'end');
        break;
      default:
        return false;
    }
    return true;
  };

  #autoChanged(state: AutoScrollState): void {
    if (this.#disposed || !this.#auto) return;
    this.#tracker.autoScroll(state === 'running');
    clearTimeout(this.#pillTimer);
    this.#set({ auto: { state, speed: this.#auto.settings.speed, visible: state !== 'off' } });
    // The pill is a transient notice: it fades 1.5 s after the last change.
    this.#pillTimer = setTimeout(() => this.#set({ auto: { ...this.#state.auto, visible: false } }), 1500);
  }

  // ───────────── stats ─────────────

  #visibility = (): void => {
    this.#tracker.visibility(
      this.#ready &&
        this.#focused &&
        !document.hidden &&
        !this.#bossHidden &&
        !this.#suspended &&
        !overlays.covering(), // a pinned Contents panel still counts as reading
    );
  };

  #tick(): void {
    const stats = useSettings.getState().settings.stats;
    this.#tracker.configure(stats.enabled, stats.idleTimeoutSec * 1000);
    this.#visibility();
    this.#tracker.tick();
    void this.#tracker.flushPending().catch(() => undefined);
    const loc = this.#state.position;
    const chars = this.#sectionChars;
    let estimates: Estimates = {};
    if (stats.enabled && loc && chars) {
      const before = chars.slice(0, loc.sectionIndex).reduce((a, b) => a + b, 0);
      const total = chars.reduce((a, b) => a + b, 0);
      estimates = readingEstimates(
        this.#tracker.speed,
        (chars[loc.sectionIndex] ?? 0) - loc.charOffset,
        total - (before + loc.charOffset),
        /^(zh|ja|ko)/i.test(this.#source?.metadata.language ?? '') || /[㐀-鿿]/u.test(loc.snippet),
      );
    }
    if (!sameEstimates(estimates, this.#state.estimates)) this.#set({ estimates });
  }

  // ───────────── listeners ─────────────

  #listen(): void {
    const host = this.#host;
    // The key router first: a key it handles is defaultPrevented for the listeners below.
    this.#stops.push(
      installKeyRouter(window, {
        bindings: () => useSettings.getState().settings.keybindings,
        scopes: this.#scopes,
        handle: this.handle,
        stop: () => {
          this.#scroller?.stop();
          if (this.#renderer?.kind === 'continuous') this.#renderer.cancelScrollAnimation();
        },
      }),
    );

    const on = <T extends EventTarget>(target: T, type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean) => {
      target.addEventListener(type, fn, opts);
      this.#stops.push(() => target.removeEventListener(type, fn, opts));
    };
    // Reading activity and visibility (#3: one list, every listener removed on dispose).
    const activity = () => {
      this.#visibility();
      this.#tracker.activity();
    };
    for (const name of ACTIVITY_EVENTS) on(window, name, activity, true);
    on(host, 'reader-manual-input', activity);
    on(host, 'reader-pointer-activity', activity);
    on(window, 'blur', () => {
      this.#focused = false;
      this.#visibility();
      void this.#tracker.flush().catch(() => undefined);
      if (!document.hasFocus() && useSettings.getState().settings.autoscroll.pauseOnBlur) this.#auto?.pause();
    });
    on(window, 'focus', () => {
      this.#focused = true;
      this.#visibility();
    });
    on(document, 'visibilitychange', () => {
      this.#visibility();
      if (!document.hidden) return;
      this.#auto?.pause();
      void this.#tracker.flush().catch(() => undefined);
    });
    const timer = setInterval(() => this.#tick(), 1000);
    this.#stops.push(() => clearInterval(timer));
    // Manual input pauses auto-scroll.
    const manual = () => this.#auto?.pause();
    on(host, 'reader-manual-input', manual);
    on(host, 'pointerdown', manual);
    on(host, 'touchstart', manual);
    on(window, 'keydown', ((e: KeyboardEvent) => {
      if (!e.defaultPrevented && !e.isComposing && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) manual();
    }) as EventListener);
    // Anything opening on top (menu, dialog, panel) pauses auto-scroll (AS-04.1); the stats clock
    // stops only while something covers the text.
    let open = overlays.snapshot().length;
    this.#stops.push(
      overlays.subscribe(() => {
        const now = overlays.snapshot().length;
        if (now > open) this.#auto?.pause();
        open = now;
        this.#visibility();
      }),
    );
    on(window, 'click', this.#pointerFocus as EventListener);
    on(host, 'scroll', this.#scheduleMarks, true);
    on(
      window,
      'wheel',
      ((e: WheelEvent) => {
        if (this.#suspended) return;
        this.#stopMotion();
        if (e.ctrlKey && e.deltaY) {
          e.preventDefault();
          this.#changeFont(useSettings.getState().effectiveStyle.font.size + (e.deltaY < 0 ? 1 : -1));
        }
      }) as EventListener,
      { passive: false },
    );
    const motionChanged = () => {
      this.#scroller?.setReducedMotion(this.#motionQuery.matches);
      this.#auto?.setReducedMotion(this.#motionQuery.matches);
      if (this.#renderer?.kind === 'continuous') this.#renderer.cancelScrollAnimation();
    };
    this.#motionQuery.addEventListener('change', motionChanged);
    this.#stops.push(() => this.#motionQuery.removeEventListener('change', motionChanged));
    this.#stops.push(
      subscribeReadingPause(() => {
        this.#tracker.visibility(false);
        void this.#tracker.flush().catch(() => undefined);
        this.#stopMotion();
      }),
    );
    const keep = (stop: Promise<() => void>) =>
      void stop
        .then((un) => (this.#disposed ? un() : this.#stops.push(un)))
        .catch(this.#notify);
    keep(
      listen('boss://hidden', () => {
        this.#bossHidden = true;
        this.#visibility();
        pauseReading();
        void this.save().catch(this.#notify);
      }),
    );
    keep(
      listen('boss://shown', () => {
        this.#bossHidden = false;
        this.#focused = true;
        this.#visibility();
      }),
    );
    this.#stops.push(useSettings.subscribe((next, previous) => this.#settingsChanged(next, previous)));
  }

  #settingsChanged(
    next: ReturnType<typeof useSettings.getState>,
    previous: ReturnType<typeof useSettings.getState>,
  ): void {
    if (this.#disposed) return;
    const s = next.settings;
    if (this.book.format === 'txt' && JSON.stringify(s.txt) !== JSON.stringify(previous.settings.txt)) {
      this.#txtRevision++;
      this.#applyTxtIfDirty();
    }
    if (s.reader.flow !== this.#layout.flow || (s.reader.pagesPerView === 2 ? 2 : 1) !== this.#layout.pages)
      void this.#queue.run(() => this.#applyLayout()).catch(this.#notify);
    else if (
      JSON.stringify(next.effectiveStyle) !== JSON.stringify(previous.effectiveStyle) ||
      s.epub.styleOverride !== previous.settings.epub.styleOverride
    )
      this.#applyStyle();
    const renderer = this.#renderer;
    if (!this.#ready || !renderer) return; // a mount reads the latest values itself
    if (this.#auto) this.#auto.settings = s.autoscroll;
    if (s.layout.minSpreadWidthPx !== previous.settings.layout.minSpreadWidthPx)
      renderer.setMinSpreadWidth(s.layout.minSpreadWidthPx);
    if (JSON.stringify(s.scroll) !== JSON.stringify(previous.settings.scroll)) {
      if (this.#scroller) this.#scroller.settings = s.scroll;
      if (renderer.kind === 'continuous') renderer.setPageOverlapLines(s.scroll.pageOverlapLines);
    }
  }
}

