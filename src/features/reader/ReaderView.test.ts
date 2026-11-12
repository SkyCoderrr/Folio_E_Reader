// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import txtExample from '../../../contract/examples/txt_prepare.json';
import openExample from '../../../contract/examples/book_open.json';
import type { Bookmark, BookRecord } from '@contract/types';
import type { RendererEventMap } from '../../engine/renderers/Renderer';
import type { Locator } from '@contract/types';
import { useSettings } from '../../state/settingsStore';
import { mergePatch, prune } from '../../state/appearance';
import type { Settings, SettingsPatch } from '@contract/types';
import defaults from '../../../contract/settings.defaults.json';
import { ReaderView } from './ReaderView';
import { createRenderer } from '../../engine/renderers/createRenderer';
import MainApp from '../../app/MainApp';
import { useLibrary } from '../../state/libraryStore';
import { epubSource } from '../../engine/book/epubSource';
import * as epubMeasurements from '../../engine/book/epubMeasurements';
import { overlays } from '../../state/overlayStore';

const mocks = vi.hoisted(() => ({
  mount: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  destroy: vi.fn(),
  sourceDestroy: vi.fn(),
  setStyle: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  page: vi.fn(),
  edge: vi.fn(async () => undefined),
  invoke: vi.fn(),
  listeners: new Map<string, () => void>(),
  saved: null as Locator | null,
  pages: null as unknown,
  stop: vi.fn(),
  unsubscribe: vi.fn(),
  getLocator: vi.fn(),
  goTo: vi.fn(async () => undefined),
  minSpread: vi.fn(),
  rect: vi.fn(),
  scrollBy: vi.fn(),
  atEnd: false,
  window: null as { fullscreen: boolean } | null,
  events: new Map<string, (event: never) => void>(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  overlap: vi.fn(),
  scrollerSettings: vi.fn(),
  scroller: vi.fn(),
  drop: undefined as
    | ((event: { payload: { type: 'enter' | 'over' | 'leave' | 'drop'; paths: string[] } }) => void)
    | undefined,
  stopDrop: vi.fn(),
  current: {
    sectionIndex: 1,
    cfi: null,
    charOffset: 42,
    globalCharOffset: null,
    progress: 0.4,
    snippet: 'restored',
  } as Locator,
}));
vi.mock('../../engine/book/epubSource', () => ({
  epubSource: vi.fn(async () => ({
    sections: [
      { id: 'one', size: 1000, createDocument: () => new Promise<Document>(() => {}) },
      { id: 'two', size: 3000, createDocument: () => new Promise<Document>(() => {}) },
    ],
    toc: [
      { label: 'First chapter', href: 'one' },
      { label: 'Second chapter', href: 'two' },
    ],
    resolveHref: (href: string) => ({ index: href === 'one' ? 0 : 1 }),
    metadata: { title: 'Fixture' },
    destroy: mocks.sourceDestroy,
  })),
}));
vi.mock('../../engine/renderers/createRenderer', () => ({
  createRenderer: vi.fn((layout: { flow?: string; pagesPerView?: number }) => ({
    renderer: new (class {
      kind = layout.flow === 'paged' || layout.pagesPerView === 2 ? 'paged' : 'continuous';
      holdStart = () => false;
      holdMove = () => false;
      holdEnd = vi.fn();
      sectionCount = 2;
      mount = mocks.mount;
      destroy = mocks.destroy;
      setStyle = mocks.setStyle;
      page = mocks.page;
      goToSectionEdge = mocks.edge;
      getSectionIndex = () => 1;
      getLocator = mocks.getLocator;
      on = (name: string, cb: (event: never) => void) => {
        mocks.events.set(name, cb);
        return mocks.unsubscribe;
      };
      goTo = mocks.goTo;
      setMinSpreadWidth = mocks.minSpread;
      setPageOverlapLines = mocks.overlap;
      getEffectivePagesPerView = () => 1;
      scrollBy = mocks.scrollBy;
      getLocatorRect = mocks.rect;
      isAtEnd = () => mocks.atEnd;
      getViewportHeight = () => 800;
      cancelScrollAnimation = vi.fn();
      getScrollTop = () => 100;
      getMaxScroll = () => 1000;
      getLineHeight = () => 35;
    })(),
  })),
}));
vi.mock('../../engine/input/smoothScroller', () => ({
  SmoothScroller: class {
    constructor(...args: unknown[]) {
      mocks.scroller(...args);
    }
    set settings(value: unknown) {
      mocks.scrollerSettings(value);
    }
    stop = mocks.stop;
    setReducedMotion = vi.fn();
  },
}));
vi.mock('../../engine/locator', async (original) => ({
  ...(await original<typeof import('../../engine/locator')>()),
  positionKey: async () => 'pos:fixture',
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock('../../ipc/commands', async (original) => ({
  ...(await original<typeof import('../../ipc/commands')>()),
  invoke: mocks.invoke,
}));
vi.mock('../../ipc/events', () => ({
  listen: async (name: string, cb: () => void) => {
    mocks.listeners.set(name, cb);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock('../../ui/useWindowState', () => ({
  useWindowState: () => mocks.window,
  windowState: { get: () => mocks.window, subscribe: () => () => undefined },
}));
vi.mock('../../ui/TitleBar', () => ({ TitleBar: () => null }));
vi.mock('../../ui/Toaster', () => ({ Toaster: () => null }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: typeof mocks.drop) => {
      mocks.drop = cb;
      return mocks.stopDrop;
    },
  }),
}));
vi.mock('./ReaderChrome', () => ({
  ReaderChrome: vi.fn(({
    children,
    footer,
    leading,
    commands,
    sidebar,
    layout,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
    leading: React.ReactNode;
    commands: { label?: string; onSelect?: () => void }[];
    sidebar: { open: boolean; onToggle: () => void };
    layout: { flow: string; effectivePagesPerView: number };
  }) =>
    createElement(
      'div',
      null,
      leading,
      children,
      footer,
      createElement('button', { onClick: sidebar?.onToggle }, 'Sidebar toggle'),
      createElement(
        'output',
        { 'data-layout': true },
        `${layout?.flow}:${layout?.effectivePagesPerView}`,
      ),
      commands
        .filter((c) => c.label)
        .map((c) => createElement('button', { key: c.label, onClick: c.onSelect }, c.label)),
    )),
}));
vi.mock('../txt/TxtSettingsDialogs', async (original) => ({
  ...(await original<typeof import('../txt/TxtSettingsDialogs')>()),
  TxtSettingsDialogs: ({ onApply }: { onApply: (patch: { encoding: string }) => Promise<void> }) =>
    createElement(
      'button',
      {
        onClick: () => {
          void onApply({ encoding: 'gb18030' });
        },
      },
      'Pick test encoding',
    ),
}));
let root: Root;
let container: HTMLDivElement;
const saveRef = { current: null as (() => Promise<void>) | null };
const back = vi.fn(),
  quit = vi.fn();
let disk: Settings;
beforeEach(() => {
  disk = structuredClone(defaults) as Settings;
  useSettings.setState({ loaded: false });
  useLibrary.setState({ opened: null, openedData: null, books: [], selection: [], query: '', formatFilter: 'all' });
  vi.clearAllMocks();
  mocks.saved = null;
  mocks.atEnd = false;
  mocks.window = null;
  mocks.rect.mockReturnValue(null);
  mocks.pages = null;
  mocks.getLocator.mockImplementation(() => mocks.current);
  mocks.listeners.clear();
  mocks.events.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  mocks.invoke.mockImplementation(
    async (
      command: string,
      args: { key?: string; value?: unknown; locator?: Locator; patch?: SettingsPatch },
    ) => {
      if (command === 'settings_get') return structuredClone(disk);
      if (command === 'book_open') return openExample.result;
      if (command === 'library_list') return [openExample.result.book];
      if (command === 'book_open') return openExample.result;
      if (command === 'settings_patch') {
        disk = mergePatch(disk, args.patch);
        disk.styleOverrides = prune((disk.styleOverrides ?? {}) as Record<string, unknown>);
        return structuredClone(disk);
      }
      if (command === 'position_get') return mocks.saved;
      if (command === 'bookmarks_list') return [];
      if (command === 'window_set_fullscreen') {
        mocks.window = { fullscreen: (args as { fullscreen: boolean }).fullscreen };
        return null;
      }
      if (command === 'position_save') {
        mocks.saved = args.locator!;
        return null;
      }
      if (command === 'kv_get')
        return args.key === 'reader.pagesPerView' ? mocks.pages : mocks.saved;
      if (command === 'kv_set') {
        if (args.key === 'reader.pagesPerView') mocks.pages = args.value;
        else mocks.saved = args.value as Locator;
        return null;
      }
      return null;
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  overlays.reset();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function open() {
  await act(async () => {
    root.render(
      createElement(ReaderView, {
        book: openExample.result.book as BookRecord,
        onBack: back,
        onQuit: quit,
        saveRef,
      }),
    );
  });
}
async function key(code: string, extra = {}) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra }),
    );
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, ...extra }));
  });
}
it('flushes the current location before returning and restores it on reopening', async () => {
  await open();
  await key('KeyW', { ctrlKey: true });
  expect(back).toHaveBeenCalledOnce();
  expect(mocks.saved).toEqual(mocks.current);
  await act(async () => root.render(null));
  await open();
  expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(mocks.current);
});

it('does not overwrite the saved location when React detaches the reader before cleanup', async () => {
  mocks.getLocator.mockImplementation(() =>
    container.querySelector('.reader-mount')
      ? mocks.current
      : { sectionIndex: 0, cfi: null, charOffset: 0, globalCharOffset: null, progress: 0, snippet: '' },
  );
  await open();
  await key('KeyW', { ctrlKey: true });
  expect(mocks.saved).toEqual(mocks.current);
  await act(async () => root.render(null));
  expect(mocks.saved).toEqual(mocks.current);
  await open();
  expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(mocks.current);
});

it('flushes the old renderer position before a layout switch without waiting for debounce', async () => {
  await open();
  mocks.invoke.mockClear();
  await act(async () => useSettings.getState().setReader({ reader: { flow: 'paged' } }));
  expect(mocks.invoke).toHaveBeenCalledWith('position_save', {
    bookId: openExample.result.book.id,
    locator: mocks.current,
  });
  expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(mocks.current);
});

it('flushes the latest relocation on direct unmount even after the iframe is gone', async () => {
  await open();
  const latest = { ...mocks.current, charOffset: 777, snippet: 'last live line' };
  await act(async () => mocks.events.get('relocate')?.({ locator: latest, reason: 'scroll' } as never));
  mocks.getLocator.mockReturnValue({
    sectionIndex: 0, cfi: null, charOffset: 0, globalCharOffset: null, progress: 0, snippet: '',
  });
  await act(async () => root.render(null));
  expect(mocks.saved).toEqual(latest);
});

it('opens TXT through txt_prepare and keeps the global offset when encoding changes', async () => {
  const initial = {
    bookId: 'txt',
    encoding: 'utf-8',
    detectedEncoding: 'utf-8',
    lang: 'zh-Hans',
    totalChars: 100,
    sections: [{ index: 0, title: 'Chapter', path: 'cache.html', startChar: 0, chars: 100 }],
  };
  let prepared = 0;
  const at = { ...mocks.current, globalCharOffset: 73 };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'settings_get') return structuredClone(disk);
      if (command === 'book_open') return openExample.result;
    if (command === 'position_get') return at;
    if (command === 'txt_prepare')
      return prepared++ === 0
        ? initial
        : {
            ...initial,
            encoding: 'gb18030',
            sections: [
              { ...initial.sections[0], chars: 50 },
              { ...initial.sections[0], index: 1, startChar: 50, chars: 50 },
            ],
          };
    if (command === 'txt_prefs_set') return { encoding: 'gb18030' };
    return null;
  });
  mocks.getLocator.mockReturnValue(at);
  await act(async () =>
    root.render(
      createElement(ReaderView, {
        book: { ...openExample.result.book, format: 'txt' } as BookRecord,
        onBack: back,
        onQuit: quit,
        saveRef,
      }),
    ),
  );
  expect(epubSource).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith('txt_prepare', { bookId: openExample.result.book.id });
  expect(mocks.mount.mock.calls[0]?.[1]).toMatchObject({ format: 'txt' });
  expect(mocks.mount.mock.calls[0]?.[3]).toEqual(at);
  await key('KeyT');
  await act(async () => emit('relocate', { locator: at, reason: 'mount' }));
  expect(container.querySelector('[aria-current="true"]')?.textContent).toMatch(/^Chapter/);
  await act(async () => (container.querySelector('[role="treeitem"]') as HTMLElement).click());
  expect(mocks.goTo).toHaveBeenCalledWith({ href: 's0.html' });
  expect(mocks.mount.mock.calls[0]?.[2]).toMatchObject({
    css: expect.stringContaining('text-indent: 2em'),
  });
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
  await act(async () => button('Text Encoding…').click());
  await act(async () => button('Pick test encoding').click());
  expect(mocks.invoke).toHaveBeenCalledWith('txt_prefs_set', {
    bookId: openExample.result.book.id,
    patch: { encoding: 'gb18030' },
  });
  expect(mocks.mount).toHaveBeenCalledTimes(2);
  expect(mocks.mount.mock.calls[1]?.[3]).toEqual(at);
  const bridge = vi.mocked(createRenderer).mock.calls.at(-1)?.[1]?.locatorBridge;
  expect(bridge?.fromGlobalCharOffset?.(73)).toEqual({ sectionIndex: 1, charOffset: 23 });
  expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
  await act(async () =>
    (container.querySelectorAll('[role="treeitem"]')[1] as HTMLElement).click(),
  );
  expect(mocks.goTo).toHaveBeenCalledWith({ href: 's1.html' });
});
it('wires page/edge keys and font sizing to the public renderer API', async () => {
  await open();
  await key('PageDown');
  await key('End');
  await key('Home', { ctrlKey: true });
  expect(mocks.page).toHaveBeenCalledWith(1);
  expect(mocks.edge).toHaveBeenCalledWith(1, 'end');
  expect(mocks.edge).toHaveBeenCalledWith(0, 'start');
  await key('Equal', { ctrlKey: true });
  expect(mocks.setStyle.mock.calls.at(-1)?.[0]).toMatchObject({ fontSizePx: 21 });
  await key('Digit0', { ctrlKey: true });
  expect(mocks.setStyle.mock.calls.at(-1)?.[0]).toMatchObject({ fontSizePx: 20 });
});
it('toggles fullscreen, escapes fullscreen first, and flushes on boss hide', async () => {
  await open();
  await key('F11');
  await key('Escape');
  expect(back).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith('window_set_fullscreen', { fullscreen: true });
  expect(mocks.invoke).toHaveBeenCalledWith('window_set_fullscreen', { fullscreen: false });
  await act(async () => mocks.listeners.get('boss://hidden')?.());
  expect(mocks.saved).toEqual(mocks.current);
  await saveRef.current?.();
  expect(mocks.saved).toEqual(mocks.current);
});
it('defaults to one page and toggles twice with the locator and source preserved', async () => {
  await open();
  expect(createRenderer).toHaveBeenCalledWith(
    { flow: 'scroll', pagesPerView: 1 },
    expect.objectContaining({ pageOverlapLines: defaults.scroll.pageOverlapLines }),
  );
  await key('Equal', { ctrlKey: true });
  for (const pagesPerView of [2, 1]) {
    await key('KeyD');
    expect(createRenderer).toHaveBeenLastCalledWith(
      { flow: 'scroll', pagesPerView },
      expect.any(Object),
    );
    expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(mocks.current);
    expect(mocks.mount.mock.calls.at(-1)?.[1]).toBe(mocks.mount.mock.calls[0]?.[1]);
    expect(mocks.mount.mock.calls.at(-1)?.[2]).toMatchObject({ fontSizePx: 21, pageGapPx: 48 });
    expect(useSettings.getState().settings.reader.pagesPerView).toBe(pagesPerView);
  }
  expect(mocks.sourceDestroy).not.toHaveBeenCalled();
  expect(mocks.destroy).toHaveBeenCalledTimes(2);
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(6); // relocate, load, spread per replaced renderer
  expect(mocks.scroller).toHaveBeenCalledTimes(3);
  const created = vi.mocked(createRenderer).mock.results;
  expect(mocks.scroller.mock.calls[1]?.[0]).toBe(created[1]?.value.renderer);
  expect(mocks.scroller.mock.calls[2]?.[0]).toBe(created[2]?.value.renderer);
  const order = (mock: { mock: { invocationCallOrder: number[] } }, index = 0) =>
    mock.mock.invocationCallOrder[index]!;
  expect(order(mocks.stop)).toBeLessThan(order(mocks.getLocator));
  expect(order(mocks.getLocator)).toBeLessThan(order(mocks.unsubscribe));
  expect(order(mocks.unsubscribe)).toBeLessThan(order(mocks.destroy));
  expect(order(mocks.destroy)).toBeLessThan(order(vi.mocked(createRenderer), 1));
  expect(order(vi.mocked(createRenderer), 1)).toBeLessThan(order(mocks.mount, 1));
  expect(order(mocks.mount, 1)).toBeLessThan(order(mocks.scroller, 1));
});
it('restores only a valid saved page preference across reader openings', async () => {
  mocks.pages = '2';
  await open();
  expect(createRenderer).toHaveBeenLastCalledWith(
    { flow: 'scroll', pagesPerView: 1 },
    expect.any(Object),
  );
  await key('KeyD');
  await act(async () => root.render(null));
  await open();
  expect(createRenderer).toHaveBeenLastCalledWith(
    { flow: 'scroll', pagesPerView: 2 },
    expect.any(Object),
  );
});
it('ignores a second toggle while the replacement renderer is mounting', async () => {
  await open();
  let mounted!: () => void;
  mocks.mount.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        mounted = resolve;
      }),
  );
  await key('KeyD');
  await key('KeyD');
  expect(createRenderer).toHaveBeenCalledTimes(2);
  await act(async () => mounted());
  expect(useSettings.getState().settings.reader.pagesPerView).toBe(2);
});

it('previews store appearance changes without remounting and resets to the active preset', async () => {
  await open();
  await act(async () => {
    useSettings.getState().patchStyle({ font: { size: 25 }, text: { lineHeight: 2 } });
    useSettings.getState().saveAsPreset('Reader test');
    useSettings.getState().patchStyle({ font: { size: 30 } });
  });
  expect(mocks.setStyle.mock.calls.at(-1)?.[0]).toMatchObject({ fontSizePx: 30 });
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  expect(mocks.destroy).not.toHaveBeenCalled();
  await key('Digit0', { ctrlKey: true });
  expect(mocks.setStyle.mock.calls.at(-1)?.[0]).toMatchObject({ fontSizePx: 25 });
  await saveRef.current?.();
  expect(mocks.saved).toEqual(mocks.current);
});
it('applies style edits made while a replacement renderer is mounting', async () => {
  await open();
  let mounted!: () => void;
  mocks.mount.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        mounted = resolve;
      }),
  );
  await key('KeyD');
  await act(async () => useSettings.getState().patchStyle({ font: { size: 31 } }));
  await act(async () => mounted());
  expect(mocks.setStyle.mock.calls.at(-1)?.[0]).toMatchObject({ fontSizePx: 31 });
  expect(mocks.mount).toHaveBeenCalledTimes(2);
  expect(mocks.getLocator).toHaveBeenCalled();
});

it('starts in Library, opens through book_open, and returns with Ctrl+W or the reader back button', async () => {
  await act(async () => root.render(createElement(MainApp)));
  expect(container.querySelector('h1')?.textContent).toBe('Library');
  const openBook = async () => {
    const card = container.querySelector('[data-book-id]')!;
    await act(async () => card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(mocks.invoke).toHaveBeenCalledWith('book_open', { bookId: openExample.result.book.id });
    expect(mocks.invoke).toHaveBeenCalledWith('position_get', {
      bookId: openExample.result.book.id,
    });
    expect(container.querySelector('.reader-mount')).not.toBeNull();
    expect(epubSource).toHaveBeenCalledWith(`asset:${openExample.result.book.filePath}`);
  };
  await openBook();
  await key('KeyW', { ctrlKey: true });
  expect(container.querySelector('h1')?.textContent).toBe('Library');
  expect(mocks.invoke).toHaveBeenCalledWith('position_save', {
    bookId: openExample.result.book.id,
    locator: mocks.current,
  });
  await openBook();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click(),
  );
  expect(container.querySelector('h1')?.textContent).toBe('Library');
  expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(mocks.current);
});

it('allows Ctrl+W while the initial reader mount is still pending', async () => {
  let release!: () => void;
  mocks.mount.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await open();
  await key('KeyW', { ctrlKey: true });
  expect(back).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  await act(async () => release());
});

it('shows the DropOverlay for native enter/over and hides it on leave/drop while importing paths', async () => {
  await act(async () => root.render(createElement(MainApp)));
  const overlay = () => container.querySelector('[role="presentation"][data-visible]');
  expect(overlay()?.getAttribute('data-visible')).toBe('false');
  for (const type of ['enter', 'over', 'leave', 'enter', 'drop'] as const) {
    await act(async () => mocks.drop!({ payload: { type, paths: ['C:\\fixtures\\books'] } }));
    expect(overlay()?.getAttribute('data-visible')).toBe(
      String(type === 'enter' || type === 'over'),
    );
  }
  expect(mocks.invoke).toHaveBeenCalledWith('library_import', {
    jobId: expect.any(String),
    paths: ['C:\\fixtures\\books'],
  });
  await act(async () => root.render(null));
  expect(mocks.stopDrop).toHaveBeenCalledOnce();
});

function emit<K extends keyof RendererEventMap>(name: K, event: RendererEventMap[K]) {
  mocks.events.get(name)?.(event as never);
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
const sidebar = () => container.querySelector('aside[aria-label="Contents"]')!;
it('returns focus to the reader when Escape closes a focused TOC', async () => {
  await open();
  await key('KeyT');
  const row = container.querySelector<HTMLElement>('[role="treeitem"]')!;
  await act(async () => row.focus());
  expect(document.activeElement).toBe(row);
  await key('Escape');
  expect(sidebar().getAttribute('data-open')).toBe('false');
  expect(document.activeElement).toBe(container.querySelector('.reader-mount'));
  expect(back).not.toHaveBeenCalled();
});
it('routes T / Ctrl+B / Esc and mouse toggle with the requested tab and motion', async () => {
  await open();
  await key('KeyT');
  expect(sidebar().getAttribute('data-open')).toBe('true');
  expect(sidebar().getAttribute('data-animate')).toBe('false');
  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    'Contents',
  );
  await key('KeyT');
  expect(sidebar().getAttribute('data-open')).toBe('false');
  await key('KeyB', { ctrlKey: true });
  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    'Bookmarks',
  );
  await key('Escape');
  expect(sidebar().getAttribute('data-open')).toBe('false');
  expect(back).not.toHaveBeenCalled();
  await key('KeyA');
  await key('KeyT');
  const appearance = container.querySelector('aside[aria-label="Appearance"]')!;
  await act(async () =>
    ['keydown', 'keyup'].forEach((type) =>
      appearance.dispatchEvent(
        new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
      ),
    ),
  );
  expect(sidebar().getAttribute('data-open')).toBe('false');
  expect(appearance.getAttribute('data-open')).toBe('true');
  await act(async () =>
    ['keydown', 'keyup'].forEach((type) =>
      appearance.dispatchEvent(
        new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
      ),
    ),
  );
  expect(appearance.getAttribute('data-open')).toBe('false');
  await act(async () => button('Sidebar toggle').click());
  expect(sidebar().getAttribute('data-animate')).toBe('true');
  await key('KeyA');
  await key('Escape');
  expect(sidebar().getAttribute('data-open')).toBe('true');
  await key('Escape');
  expect(sidebar().getAttribute('data-open')).toBe('false');
  expect(back).not.toHaveBeenCalled();
});
it('follows relocate events (the one current chapter) and navigates TOC hrefs through goTo', async () => {
  await open();
  await key('KeyT');
  await act(async () => emit('relocate', { locator: mocks.current, reason: 'mount' }));
  expect(container.querySelector('[aria-current="true"]')?.textContent).toMatch(/^Second chapter/);
  await act(async () =>
    emit('relocate', { locator: { ...mocks.current, sectionIndex: 0 }, reason: 'scroll' }),
  );
  expect(container.querySelector('[aria-current="true"] [title="First chapter"]')?.textContent).toBe('First chapter');
  await act(async () =>
    (container.querySelectorAll('[role="treeitem"]')[1] as HTMLElement).click(),
  );
  expect(mocks.goTo).toHaveBeenCalledWith({ href: 'two' });
});
it('lists, toggles, opens, deletes and undoes bookmarks using IPC', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  let rows: Bookmark[] = [];
  let id = 0;
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'bookmarks_list') return rows;
    if (command === 'bookmark_add') {
      const row = {
        ...args,
        id: String(++id),
        progress: (args.locator as Locator).progress,
        createdAt: Date.now(),
      } as unknown as Bookmark;
      rows = [...rows, row];
      return row;
    }
    if (command === 'bookmark_remove') {
      rows = rows.filter((b) => b.id !== args.bookmarkId);
      return null;
    }
    return original(command, args);
  });
  mocks.getLocator.mockReturnValue({ ...mocks.current, snippet: 'Visible text '.repeat(10) });
  await open();
  expect(mocks.invoke).toHaveBeenCalledWith('bookmarks_list', {
    bookId: openExample.result.book.id,
  });
  await key('KeyD', { ctrlKey: true });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.chapterTitle).toBe('Second chapter');
  expect(rows[0]?.snippet).toHaveLength(60);
  await key('KeyB', { ctrlKey: true });
  await act(async () =>
    (container.querySelector('ul[aria-label="Bookmarks"] button') as HTMLElement).click(),
  );
  expect(mocks.goTo).toHaveBeenCalledWith(rows[0]?.locator);
  await key('KeyD', { ctrlKey: true });
  expect(rows).toHaveLength(0);
  await act(async () => mocks.toast.mock.calls.at(-1)?.[1].action.onClick());
  expect(rows).toHaveLength(1);
  await act(async () =>
    (
      container.querySelector('button[aria-label="Delete bookmark: Second chapter"]') as HTMLElement
    ).click(),
  );
  expect(rows).toHaveLength(0);
  await act(async () => mocks.toast.mock.calls.at(-1)?.[1].action.onClick());
  expect(rows).toHaveLength(1);
  expect(container.querySelector('ul[aria-label="Bookmarks"]')?.textContent).toContain(
    'Visible text',
  );
});
it('toggles flow with M preserving pagesPerView and updates the spread threshold live', async () => {
  await open();
  expect(createRenderer).toHaveBeenCalledWith(
    { flow: 'scroll', pagesPerView: 1 },
    expect.objectContaining({ minSpreadWidthPx: defaults.layout.minSpreadWidthPx }),
  );
  await key('KeyD');
  for (const flow of ['paged', 'scroll']) {
    await key('KeyM');
    expect(createRenderer).toHaveBeenLastCalledWith({ flow, pagesPerView: 2 }, expect.any(Object));
    expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(mocks.current);
  }
  const mounts = mocks.mount.mock.calls.length;
  await act(async () => useSettings.getState().setReader({ layout: { minSpreadWidthPx: 1100 } }));
  expect(mocks.minSpread).toHaveBeenLastCalledWith(1100);
  expect(mocks.mount).toHaveBeenCalledTimes(mounts);
  await act(async () => emit('spread', { pagesPerView: 1, requested: 2 }));
  expect(container.querySelector('[data-layout]')?.textContent).toBe('scroll:1');
  await act(async () => emit('spread', { pagesPerView: 2, requested: 2 }));
  expect(container.querySelector('[data-layout]')?.textContent).toBe('scroll:2');
});

it('loads persisted bookmarks and keeps progress order after adding a Unicode snippet', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  const existing: Bookmark = {
    id: '5',
    bookId: openExample.result.book.id,
    locator: { ...mocks.current, charOffset: 100, progress: 0.9 },
    progress: 0.9,
    chapterTitle: 'Later bookmark',
    snippet: 'Saved',
    createdAt: 1,
  };
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'bookmarks_list') return [existing];
    if (command === 'bookmark_add') return { ...args, id: '6', progress: 0.4, createdAt: 2 };
    return original(command, args);
  });
  mocks.getLocator.mockReturnValue({ ...mocks.current, snippet: '\u{1f600}'.repeat(70) });
  await open();
  await key('KeyB', { ctrlKey: true });
  expect(container.querySelector('ul[aria-label="Bookmarks"]')?.textContent).toContain(
    'Later bookmark',
  );
  await key('KeyD', { ctrlKey: true });
  expect(mocks.invoke).toHaveBeenCalledWith(
    'bookmark_add',
    expect.objectContaining({ snippet: '\u{1f600}'.repeat(60) }),
  );
  const labels = [...container.querySelectorAll('ul[aria-label="Bookmarks"] li')].map(
    (li) => li.textContent,
  );
  expect(labels[0]).toContain('Second chapter');
  expect(labels[1]).toContain('Later bookmark');
});

it('opens real Settings from the reader, persists its pane, and returns without remounting', async () => {
  useLibrary.setState({ opened: openExample.result.book as BookRecord });
  await act(async () => root.render(createElement(MainApp)));
  const mounts = mocks.mount.mock.calls.length;
  await act(async () => button('Settings').click());
  expect(container.querySelector('[data-settings-screen]')).not.toBeNull();
  const scrolling = [...container.querySelectorAll('[role="tab"]')].find(
    (e) => e.textContent === 'Scrolling',
  ) as HTMLElement;
  await act(async () => scrolling.click());
  await act(async () => useSettings.getState().flush());
  expect(disk.ui.settingsLastPane).toBe('scrolling');
  await key('Escape');
  expect(container.querySelector('[data-settings-screen]')).toBeNull();
  await key('Comma', { ctrlKey: true });
  expect(
    container.querySelector('[data-settings-screen] [role="tab"][aria-selected="true"]')
      ?.textContent,
  ).toBe('Scrolling');
  expect(mocks.mount).toHaveBeenCalledTimes(mounts);
});

it('persists reader Appearance UI edits and applies style to the existing renderer', async () => {
  await open();
  await key('KeyA');
  expect(container.querySelector('aside[aria-label="Appearance"]')?.getAttribute('data-open')).toBe(
    'true',
  );
  const input = container.querySelector('input[aria-label="Size value"]') as HTMLInputElement;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '28');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
  expect(mocks.setStyle.mock.calls.at(-1)?.[0]).toMatchObject({ fontSizePx: 28 });
  await act(async () => useSettings.getState().flush());
  expect(disk.styleOverrides.font?.size).toBe(28);
  const mounts = mocks.mount.mock.calls.length;
  await act(async () => button('Sepia').click());
  expect(mocks.setStyle.mock.calls.at(-1)?.[0]).toMatchObject({ fontSizePx: 20 });
  expect(mocks.mount).toHaveBeenCalledTimes(mounts);
  await act(async () => useSettings.getState().flush());
  expect(disk.activePresetId).toBe('builtin.sepia');
});

it('feeds persisted key rebindings and scrolling settings live to the router and scroller', async () => {
  await open();
  await act(async () =>
    useSettings.getState().patch({
      keybindings: { 'page.next': ['J'] },
      scroll: { arrowSpeed: 1500, stopDecelMs: 200, pageOverlapLines: 4 },
    }),
  );
  expect(mocks.scrollerSettings).toHaveBeenLastCalledWith(
    expect.objectContaining({ arrowSpeed: 1500, stopDecelMs: 200 }),
  );
  expect(mocks.overlap).toHaveBeenLastCalledWith(4);
  await key('PageDown');
  expect(mocks.page).not.toHaveBeenCalled();
  await key('KeyJ');
  expect(mocks.page).toHaveBeenCalledWith(1);
  await act(async () => useSettings.getState().flush());
  expect(disk.keybindings['page.next']).toEqual(['J']);
});

it('queries startup boss failures after listeners and shows a toast and Settings banner', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: never) => {
    if (command === 'boss_get_status') {
      expect(mocks.listeners.has('boss://register-failed')).toBe(true);
      return {
        enabled: true,
        registered: false,
        shortcut: 'Ctrl+Alt+B',
        error: { code: 'SHORTCUT_IN_USE', message: 'Already occupied' },
      };
    }
    return original(command, args);
  });
  await act(async () => root.render(createElement(MainApp)));
  expect(mocks.toast.error).toHaveBeenCalledWith('Boss key Ctrl+Alt+B is in use by another app. Choose another in Settings › Keyboard.', { id: 'boss-key-registration' });
  await act(async () => mocks.listeners.get('tray://open-settings')?.());
  expect(container.textContent).toContain('Boss key Ctrl+Alt+B is in use by another app');
  expect(container.textContent).not.toContain('Already occupied');
});

it('tray Library saves the current locator before closing the book', async () => {
  useLibrary.setState({ opened: openExample.result.book as BookRecord });
  await act(async () => root.render(createElement(MainApp)));
  await act(async () => mocks.listeners.get('tray://open-library')?.());
  expect(mocks.saved).toEqual(mocks.current);
  expect(useLibrary.getState().opened).toBeNull();
});

it('runs the library folder picker, move confirmation and managed reset flow', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'dialog_pick_folder') return 'C:\\NewBooks';
    if (command === 'library_set_folder') {
      disk.library.folder = args.path as string | null;
      (
        mocks.listeners.get('settings://changed') as unknown as (event: {
          settings: Settings;
          cause: string;
        }) => void
      )({ settings: structuredClone(disk), cause: 'libraryFolder' });
      return { libraryDir: args.path ?? 'C:\\DefaultLibrary', moved: 1, failed: [] };
    }
    return original(command, args);
  });
  await act(async () => root.render(createElement(MainApp)));
  await key('Comma', { ctrlKey: true });
  const libraryTab = [...container.querySelectorAll('[role="tab"]')].find(
    (e) => e.textContent === 'Library',
  ) as HTMLElement;
  await act(async () => libraryTab.click());
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.startsWith('Change'))!
      .click(),
  );
  expect(document.body.textContent).toContain('Move existing books?');
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'library_set_folder')).toBe(false);
  const clickDialog = async (text: string) =>
    act(async () =>
      (
        [...document.body.querySelectorAll('button')].find(
          (e) => e.textContent === text,
        ) as HTMLElement
      ).click(),
    );
  await clickDialog('Move books');
  expect(mocks.invoke).toHaveBeenCalledWith('library_set_folder', {
    path: 'C:\\NewBooks',
    moveFiles: true,
  });
  expect(container.querySelector('[data-testid="library-dir"]')?.textContent).toBe('C:\\NewBooks');
  await act(async () => button('Reset to Default').click());
  await clickDialog('Keep existing files');
  expect(mocks.invoke).toHaveBeenCalledWith('library_set_folder', { path: null, moveFiles: false });
  expect(useSettings.getState().settings.library.folder).toBeNull();
});

it('shows managed folder failures inline and leaves the confirmation available to retry', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: never) => {
    if (command === 'dialog_pick_folder') return 'C:\\NoAccess';
    if (command === 'library_set_folder') throw { code: 'IO_ERROR', message: 'Access denied' };
    return original(command, args);
  });
  await act(async () => root.render(createElement(MainApp)));
  await key('Comma', { ctrlKey: true });
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (e) => e.textContent === 'Library',
  ) as HTMLElement;
  await act(async () => tab.click());
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.startsWith('Change'))!
      .click(),
  );
  await act(async () =>
    (
      [...document.body.querySelectorAll('button')].find(
        (e) => e.textContent === 'Move books',
      ) as HTMLElement
    ).click(),
  );
  expect(container.textContent).toContain('A file could not be read or written.'); // IO_ERROR copy
  expect(container.textContent).not.toContain('Access denied');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it('records and resets keybindings through the real Keyboard pane', async () => {
  await act(async () => root.render(createElement(MainApp)));
  await key('Comma', { ctrlKey: true });
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (e) => e.textContent === 'Keyboard',
  ) as HTMLElement;
  await act(async () => tab.click());
  await act(async () =>
    (
      container.querySelector('[aria-label="Add shortcut for Appearance panel"]') as HTMLElement
    ).click(),
  );
  await key('KeyJ', { ctrlKey: true });
  expect(useSettings.getState().settings.keybindings['appearance.toggle']).toEqual(['A', 'Ctrl+J']);
  await act(async () => useSettings.getState().flush());
  expect(disk.keybindings['appearance.toggle']).toEqual(['A', 'Ctrl+J']);
  await act(async () =>
    (container.querySelector('[aria-label="Reset Appearance panel"]') as HTMLElement).click(),
  );
  expect(useSettings.getState().settings.keybindings['appearance.toggle']).toBeUndefined();
});

it('records a boss chord through managed IPC and shows switch failures inline', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'boss_get_status')
      return { enabled: false, registered: false, shortcut: 'Ctrl+Alt+B', error: null };
    if (command === 'boss_set_shortcut')
      return { enabled: false, registered: false, shortcut: args.shortcut, error: null };
    if (command === 'boss_set_enabled')
      throw { code: 'SHORTCUT_IN_USE', message: 'Another app owns this chord' };
    return original(command, args);
  });
  await act(async () => root.render(createElement(MainApp)));
  await key('Comma', { ctrlKey: true });
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (e) => e.textContent === 'Keyboard',
  ) as HTMLElement;
  await act(async () => tab.click());
  await act(async () => button('Record').click());
  await key('KeyJ', { ctrlKey: true, altKey: true });
  expect(mocks.invoke).toHaveBeenCalledWith('boss_set_shortcut', { shortcut: 'Ctrl+Alt+J' });
  await act(async () => (container.querySelector('[role="switch"]') as HTMLElement).click());
  expect(mocks.invoke).toHaveBeenCalledWith('boss_set_enabled', { enabled: true });
  expect(container.textContent).toContain('That shortcut is used by another app.'); // SHORTCUT_IN_USE copy
});

it('reprepares an open TXT after global TXT settings persist, preserving its locator', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: never) => {
    if (command === 'txt_prepare') return txtExample.result;
    return original(command, args);
  });
  await act(async () =>
    root.render(
      createElement(ReaderView, {
        book: { ...openExample.result.book, format: 'txt' } as BookRecord,
        onBack: back,
        onQuit: quit,
        saveRef,
      }),
    ),
  );
  expect(mocks.mount).toHaveBeenCalledOnce();
  await act(async () => {
    useSettings.getState().patch({ txt: { paragraphMode: 'blank' } });
    await useSettings.getState().flush();
  });
  expect(disk.txt.paragraphMode).toBe('blank');
  expect(mocks.invoke.mock.calls.filter(([c]) => c === 'txt_prepare')).toHaveLength(2);
  expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(mocks.current);
});

function controlledFrames() {
  let time = 0,
    id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return async (ms = 16) =>
    act(async () => {
      time += ms;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb(time));
    });
}
it('wires S/Space and speed keys, persists globally, and keeps page Space when off', async () => {
  const frame = controlledFrames();
  await open();
  await key('Space');
  expect(mocks.page).toHaveBeenLastCalledWith(1);
  mocks.page.mockClear();
  await key('KeyS');
  await frame(1000);
  expect(mocks.scrollBy).toHaveBeenLastCalledWith(40);
  await key('Space');
  await frame(1000);
  expect(mocks.scrollBy).toHaveBeenCalledTimes(1);
  expect(mocks.page).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Paused');
  await key('Equal');
  expect(useSettings.getState().settings.autoscroll.speed).toBe(44);
  await act(async () => useSettings.getState().flush());
  expect(mocks.invoke).toHaveBeenCalledWith('settings_patch', {
    patch: { autoscroll: { speed: 44 } },
  });
  await key('Space');
  await frame(1000);
  expect(mocks.scrollBy).toHaveBeenLastCalledWith(44);
  await key('KeyS');
  await frame(1000);
  expect(mocks.scrollBy).toHaveBeenCalledTimes(2);
});
it.each([
  'wheel',
  'iframe',
  'pointer',
  'boss',
  'blur',
  'panel',
  'dialog',
  'menu',
  'navigation',
  'unbound key',
  'visibility',
])('pauses auto-scroll on %s', async (reason) => {
  const frame = controlledFrames();
  await open();
  await key('KeyS');
  await frame(1000);
  mocks.scrollBy.mockClear();
  await act(async () => {
    if (reason === 'wheel') window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    if (reason === 'iframe')
      container
        .querySelector('.reader-mount')!
        .dispatchEvent(new Event('reader-manual-input', { bubbles: true }));
    if (reason === 'pointer')
      container
        .querySelector('.reader-mount')!
        .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    if (reason === 'boss') mocks.listeners.get('boss://hidden')?.();
    if (reason === 'visibility') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    }
    if (reason === 'blur') {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      window.dispatchEvent(new Event('blur'));
    }
    // A Base UI menu / dialog registers itself in the overlay store while open.
    if (reason === 'dialog' || reason === 'menu') overlays.open({ id: reason, kind: 'modal' });
  });
  if (reason === 'panel') await key('KeyT');
  if (reason === 'navigation') await key('PageDown');
  if (reason === 'unbound key') await key('KeyZ');
  await frame(1000);
  expect(mocks.scrollBy).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Paused');
  await key('Space');
  // A menu/dialog owns the keyboard; a non-modal panel does not (G0: Space resumes there).
  if (reason === 'dialog' || reason === 'menu') {
    await frame(1000);
    expect(mocks.scrollBy).not.toHaveBeenCalled();
  }
});
it('honours pauseOnBlur=false, but the pause bus still pauses', async () => {
  const frame = controlledFrames();
  await open();
  await act(async () => useSettings.getState().patch({ autoscroll: { pauseOnBlur: false } }));
  await key('KeyS');
  await act(async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
  });
  await frame(1000);
  expect(mocks.scrollBy).toHaveBeenCalledWith(40);
  await act(async () => mocks.listeners.get('boss://hidden')?.());
  mocks.scrollBy.mockClear();
  await frame(1000);
  expect(mocks.scrollBy).not.toHaveBeenCalled();
});
it('hides the status pill after 1.5 seconds and shows it again on speed change', async () => {
  controlledFrames();
  await open();
  vi.useFakeTimers();
  try {
    await key('KeyS');
    expect(container.textContent).toContain('Auto-scroll');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(container.textContent).not.toContain('Auto-scroll');
    await key('Equal');
    expect(container.textContent).toContain('44 px/s');
    await key('KeyS');
  } finally {
    vi.useRealTimers();
  }
});
it('coalesces bookmark positions on scroll/relocate and removes a margin mark with undo', async () => {
  const frame = controlledFrames();
  const original = mocks.invoke.getMockImplementation()!;
  const bookmark: Bookmark = {
    id: '1',
    bookId: openExample.result.book.id,
    locator: mocks.current,
    progress: 0.4,
    chapterTitle: 'Chapter',
    snippet: 'text',
    createdAt: 1,
  };
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) =>
    command === 'bookmarks_list' ? [bookmark] : original(command, args),
  );
  mocks.rect.mockReturnValue({ left: 260, right: 270, top: 200, bottom: 224, marginLeft: 100 });
  await open();
  await frame();
  const mark = container.querySelector('button[aria-label="Remove bookmark"]') as HTMLElement;
  expect(mark).not.toBeNull();
  expect(mark.parentElement?.style.left).toBe('82px');
  expect(mark.parentElement?.style.top).toBe('200px');
  mocks.rect.mockClear();
  await act(async () => {
    const host = container.querySelector('.reader-mount')!;
    host.dispatchEvent(new Event('scroll'));
    host.dispatchEvent(new Event('scroll'));
    emit('relocate', { locator: mocks.current, reason: 'scroll' });
  });
  expect(mocks.rect).not.toHaveBeenCalled();
  mocks.rect.mockReturnValue(null);
  await frame();
  expect(mocks.rect).toHaveBeenCalledTimes(1);
  expect(container.querySelector('button[aria-label="Remove bookmark"]')).toBeNull();
  mocks.rect.mockReturnValue({ left: 260, right: 270, top: 300, bottom: 324, marginLeft: 100 });
  await act(async () => emit('relocate', { locator: mocks.current, reason: 'resize' }));
  await frame();
  await act(async () =>
    (container.querySelector('button[aria-label="Remove bookmark"]') as HTMLElement).click(),
  );
  await frame();
  expect(mocks.invoke).toHaveBeenCalledWith('bookmark_remove', { bookmarkId: '1' });
  expect(container.querySelector('button[aria-label="Remove bookmark"]')).toBeNull();
  expect(mocks.toast).toHaveBeenCalledWith(
    'Bookmark deleted',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
  );
});

it('uses reduced-motion line steps and updates the preference at runtime', async () => {
  const frame = controlledFrames();
  let changed: (() => void) | undefined;
  const query = {
    matches: true,
    addEventListener: (_: string, cb: () => void) => {
      changed = cb;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => query);
  await open();
  await key('KeyS');
  await frame(400);
  expect(mocks.scrollBy).not.toHaveBeenCalled();
  await frame(600);
  expect(mocks.scrollBy).toHaveBeenCalledWith(35);
  query.matches = false;
  await act(async () => changed?.());
  await frame(100);
  expect(mocks.scrollBy).toHaveBeenLastCalledWith(4);
});
it('uses paced page turns in paged mode and pauses at book end', async () => {
  const frame = controlledFrames();
  disk.reader.flow = 'paged';
  disk.autoscroll.speed = 400;
  await open();
  await key('KeyS');
  await frame(1990);
  expect(mocks.page).not.toHaveBeenCalled();
  await frame(20);
  expect(mocks.page).toHaveBeenCalledWith(1);
  expect(mocks.scrollBy).not.toHaveBeenCalled();
  mocks.atEnd = true;
  await frame(16);
  expect(container.textContent).toContain('Paused');
  mocks.page.mockClear();
  await frame(2000);
  expect(mocks.page).not.toHaveBeenCalled();
});

it('preserves the locator after four PageDowns across M and two-page switches', async () => {
  await open();
  const original = { ...mocks.current };
  mocks.page.mockImplementation(() => {
    mocks.current = {
      ...mocks.current,
      charOffset: mocks.current.charOffset + 800,
      progress: mocks.current.progress + 0.01,
      snippet: 'advanced text',
    };
  });
  try {
    for (let i = 0; i < 4; i++) await key('PageDown');
    const at = { ...mocks.current };
    for (const code of ['KeyM', 'KeyD', 'KeyM', 'KeyD']) {
      await key(code);
      expect(mocks.mount.mock.calls.at(-1)?.[3]).toEqual(at);
    }
  } finally {
    mocks.current = original;
    mocks.page.mockReset();
  }
});

it('saves active auto-scroll on boss hide beyond the idle timeout and excludes hidden time', async () => {
  let now = 1000000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  controlledFrames();
  await open();
  await key('KeyS');
  now += 240000;
  await act(async () => mocks.listeners.get('boss://hidden')?.());
  const saves = () => mocks.invoke.mock.calls.filter(([c]) => c === 'stats_session_save');
  expect(saves()[0]?.[1]).toMatchObject({
    session: { bookId: openExample.result.book.id, activeMs: 240000 },
  });
  now += 120000;
  await act(async () => saveRef.current?.());
  expect(saves()).toHaveLength(1);
});

it('logs a failed background EPUB cache save without notifying or delaying the mounted reader', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const source = await epubSource('fixture');
  source.sections = [0, 1].map((i) => ({
    ...source.sections[i]!,
    createDocument: async () =>
      new DOMParser().parseFromString(`<body>${'x'.repeat(1000)}</body>`, 'text/html'),
  }));
  vi.mocked(epubSource).mockResolvedValueOnce(source);
  const original = mocks.invoke.getMockImplementation()!;
  let rejectSave!: (error: unknown) => void;
  mocks.invoke.mockImplementation(async (command: string, args: never) => {
    if (command === 'book_open') return { ...openExample.result,
      epubMetrics: { fileHash: 'a'.repeat(64), sectionChars: [], tocFragmentOffsets: {} } };
    if (command === 'book_set_section_chars') return new Promise((_, reject) => { rejectSave = reject; });
    return original(command, args);
  });
  await open();
  await act(async () => vi.waitFor(() => expect(rejectSave).toBeTypeOf('function')));
  expect(mocks.invoke).toHaveBeenCalledWith('book_set_section_chars', {
    bookId: openExample.result.book.id,
    metrics: { fileHash: 'a'.repeat(64), sectionChars: [1000, 1000], tocFragmentOffsets: {} },
  });
  expect(mocks.mount).toHaveBeenCalledOnce();
  // Opening has completed even though the optional cache write is still pending.
  await key('PageDown');
  expect(mocks.page).toHaveBeenCalledWith(1);
  await act(async () => rejectSave('book_set_section_chars not allowed'));
  expect(warn).toHaveBeenCalledWith('[reader] save EPUB measurements', 'book_set_section_chars not allowed');
  expect(mocks.toast.error).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === 'stats_query')).toBe(false);
});

it('opens a warm EPUB without measuring or saving its cache', async () => {
  const measure = vi.spyOn(epubMeasurements, 'measureEpubSections');
  const source = await epubSource('fixture');
  const read = vi.fn(async () => new DOMParser().parseFromString('<body>text</body>', 'text/html'));
  source.sections = source.sections.map((section) => ({ ...section, createDocument: read }));
  vi.mocked(epubSource).mockResolvedValueOnce(source);
  await open();
  expect(mocks.mount).toHaveBeenCalledOnce();
  expect(read).not.toHaveBeenCalled();
  expect(measure).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === 'book_set_section_chars')).toBe(false);
  const { ReaderChrome } = await import('./ReaderChrome');
  expect(vi.mocked(ReaderChrome).mock.calls.at(-1)![0].readout).not.toBe('Preparing chapters…');
  expect(vi.mocked(createRenderer).mock.calls[0]![1]!.locatorBridge?.sectionChars?.()).toEqual([100, 200]);
});

it('discards background measurements after disposal without saving or publishing state', async () => {
  const { ReaderSession } = await import('./session/ReaderSession');
  const source = await epubSource('fixture');
  let release!: (doc: Document) => void;
  const read = vi.fn(() => new Promise<Document>((resolve) => { release = resolve; }));
  const nextRead = vi.fn(async () => new DOMParser().parseFromString('<body>next</body>', 'text/html'));
  source.sections = [
    { ...source.sections[0]!, createDocument: read },
    { ...source.sections[1]!, createDocument: nextRead },
  ];
  vi.mocked(epubSource).mockResolvedValueOnce(source);
  const session = new ReaderSession(openExample.result.book as BookRecord, container, { onBack: back }, {
    ...openExample.result, book: openExample.result.book as BookRecord,
    epubMetrics: { fileHash: 'a'.repeat(64), sectionChars: [], tocFragmentOffsets: {} },
  });
  const changed = vi.fn();
  session.subscribe(changed);
  await act(async () => session.start());
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  expect(mocks.mount).toHaveBeenCalledOnce();
  expect(session.getState().measuring).toBe(true);
  session.dispose();
  const before = session.getState();
  changed.mockClear();
  await act(async () => release(new DOMParser().parseFromString('<body>finished</body>', 'text/html')));
  expect(session.getState()).toBe(before);
  expect(changed).not.toHaveBeenCalled();
  expect(nextRead).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === 'book_set_section_chars')).toBe(false);
  expect(mocks.sourceDestroy).toHaveBeenCalledOnce();
  expect(mocks.toast.error).not.toHaveBeenCalled();
});

it('flushes the session through the idle timer without counting the idle tail', async () => {
  vi.useFakeTimers();
  try {
    await open();
    await act(async () => vi.advanceTimersByTimeAsync(181000));
    const saves = mocks.invoke.mock.calls.filter(([c]) => c === 'stats_session_save');
    expect(saves).toHaveLength(1);
    expect(saves[0]?.[1]).toMatchObject({ session: { activeMs: 180000 } });
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(mocks.invoke.mock.calls.filter(([c]) => c === 'stats_session_save')).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

// ── Batch 3 regressions ──
it('Escape never leaves the book: panel first, then fullscreen, then nothing', async () => {
  await open();
  await key('Escape');
  expect(back).not.toHaveBeenCalled();
  await key('KeyT');
  await key('F11');
  await key('Escape'); // closes the Contents panel
  expect(container.querySelector('aside[aria-label="Contents"]')?.getAttribute('data-open')).toBe('false');
  expect(mocks.window).toEqual({ fullscreen: true });
  await key('Escape'); // leaves fullscreen
  expect(mocks.window).toEqual({ fullscreen: false });
  await key('Escape'); // nothing left: stays in the book
  await key('Escape');
  expect(back).not.toHaveBeenCalled();
  await key('KeyW', { ctrlKey: true }); // leaving the book is its own shortcut
  expect(back).toHaveBeenCalledOnce();
});
// ── G0: the reading keys follow focus, not whether a panel is open ──
const keyOn = (target: EventTarget, code: string) =>
  act(async () => {
    const down = new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true });
    target.dispatchEvent(down);
    target.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    return down;
  });
const mouseClick = (el: Element, detail = 1) =>
  act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail })));
it('G0: with the Contents panel open (pinned) and focus not inside it, the reading keys work', async () => {
  await open();
  await key('KeyT');
  expect(container.querySelector('aside[aria-label="Contents"]')?.getAttribute('data-open')).toBe('true');
  await key('PageDown');
  expect(mocks.page).toHaveBeenCalledWith(1);
  await key('ArrowLeft'); // page.prev
  expect(mocks.page).toHaveBeenLastCalledWith(-1);
  await key('Escape'); // Escape still closes the panel first
  expect(container.querySelector('aside[aria-label="Contents"]')?.getAttribute('data-open')).toBe('false');
});
it('G0: focus on a plain chrome button: Space/Enter go to the button, arrows and PgDn still read', async () => {
  await open();
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Sidebar toggle')!;
  toggle.focus();
  const space = await keyOn(toggle, 'Space');
  expect(space.defaultPrevented).toBe(false); // the button activates
  const enter = await keyOn(toggle, 'Enter');
  expect(enter.defaultPrevented).toBe(false);
  expect(mocks.page).not.toHaveBeenCalled();
  await keyOn(toggle, 'PageDown');
  expect(mocks.page).toHaveBeenCalledWith(1);
  await keyOn(toggle, 'ArrowRight');
  expect(mocks.page).toHaveBeenCalledTimes(2);
});
it.each([
  ['the TOC tree', 'tree'],
  ['a text field', 'input'],
  ['a slider', 'slider'],
  ['a listbox', 'listbox'],
  ['a select', 'select'],
])('G0: focus inside %s leaves the reading keys to that control', async (_name, kind) => {
  await open();
  await key('KeyT');
  let el: HTMLElement;
  if (kind === 'tree') el = container.querySelector('[role="treeitem"]')!;
  else {
    el = document.createElement(kind === 'input' || kind === 'select' ? kind : 'div');
    if (kind === 'slider' || kind === 'listbox') el.setAttribute('role', kind);
    el.tabIndex = 0;
    container.append(el);
  }
  expect(el).toBeTruthy();
  el.focus();
  await keyOn(el, 'PageDown');
  await keyOn(el, 'End');
  await keyOn(el, 'Space');
  expect(mocks.page).not.toHaveBeenCalled();
  expect(mocks.edge).not.toHaveBeenCalled();
});
it('G0: an open menu, popover or dialog turns the reading keys off', async () => {
  await open();
  await act(async () => overlays.open({ id: 'menu', kind: 'modal' }));
  await key('PageDown');
  expect(mocks.page).not.toHaveBeenCalled();
  await act(async () => overlays.close('menu'));
  await key('PageDown');
  expect(mocks.page).toHaveBeenCalledWith(1);
});
it('G0: a pointer click on a chrome button or a TOC entry gives the text the keyboard; keyboard activation keeps focus', async () => {
  await open();
  const mount = container.querySelector('.reader-mount') as HTMLElement;
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Sidebar toggle')!;
  toggle.focus();
  await mouseClick(toggle, 0); // Enter/Space on the button: a click with detail 0
  expect(document.activeElement).toBe(toggle);
  expect(container.querySelector('aside[aria-label="Contents"]')?.getAttribute('data-open')).toBe('true');
  const entry = [...container.querySelectorAll('[role="treeitem"]')].find((e) =>
    e.textContent?.includes('Second chapter'),
  ) as HTMLElement;
  entry.focus();
  await mouseClick(entry);
  expect(mocks.goTo).toHaveBeenCalledWith({ href: 'two' });
  expect(document.activeElement).toBe(mount);
  await key('PageDown'); // no extra click needed
  expect(mocks.page).toHaveBeenCalledWith(1);
  toggle.focus();
  await mouseClick(toggle);
  expect(document.activeElement).toBe(mount);
  const field = document.createElement('input');
  container.append(field);
  field.focus();
  await mouseClick(field); // a value control keeps focus after a pointer press
  expect(document.activeElement).toBe(field);
});
it('Space on a focused chrome button activates the button and does not turn a page', async () => {
  await open();
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Sidebar toggle')!;
  toggle.focus();
  await act(async () => {
    const down = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    toggle.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    toggle.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
  });
  expect(mocks.page).not.toHaveBeenCalled();
  await key('Space'); // focus on the text again (window target): Space pages
  expect(mocks.page).toHaveBeenCalledWith(1);
});
it('a bookmark stores the progress the footer shows (one locator, one progress)', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) =>
    command === 'bookmark_add'
      ? { ...args, id: 'b1', progress: (args.locator as Locator).progress, createdAt: 0 }
      : original(command, args as never),
  );
  await open();
  const here = { ...mocks.current, progress: 0.4567 };
  mocks.getLocator.mockReturnValue(here);
  await act(async () => emit('relocate', { locator: here, reason: 'scroll' }));
  expect(container.textContent).toContain('45.7%');
  await key('KeyD', { ctrlKey: true });
  const add = mocks.invoke.mock.calls.find(([command]) => command === 'bookmark_add')!;
  expect((add[1] as { locator: Locator }).locator.progress).toBe(0.4567);
});
it('one transition queue: a layout swap waits for a running TXT re-split, then remounts once', async () => {
  const initial = txtExample.result;
  let release!: () => void;
  let prepared = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'settings_get') return structuredClone(disk);
      if (command === 'book_open') return openExample.result;
    if (command === 'position_get') return mocks.current;
    if (command === 'txt_prepare') return initial;
    if (command === 'txt_prefs_set') {
      prepared++;
      await new Promise<void>((resolve) => (release = resolve));
      return { encoding: 'gb18030' };
    }
    return null;
  });
  await act(async () =>
    root.render(
      createElement(ReaderView, {
        book: { ...openExample.result.book, format: 'txt' } as BookRecord,
        onBack: back,
        onQuit: quit,
        saveRef,
      }),
    ),
  );
  const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
  await act(async () => button('Text Encoding…').click());
  await act(async () => button('Pick test encoding').click());
  expect(prepared).toBe(1);
  await key('KeyD'); // layout swap while the re-split is preparing (the dialog is a test stub here)
  await key('KeyD');
  await key('KeyD');
  expect(mocks.mount).toHaveBeenCalledTimes(1); // nothing remounted in between
  await act(async () => release());
  // The re-split's mount already reads the final layout (two pages); the queued swaps find
  // nothing left to do: one remount in total, never two renderers at once.
  expect(mocks.mount).toHaveBeenCalledTimes(2);
  expect(vi.mocked(createRenderer).mock.calls.map(([layout]) => layout.pagesPerView)).toEqual([1, 2]);
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
});
it('N9: global TXT setting edits made in Settings re-split once, when the reader resumes', async () => {
  let prepares = 0;
  mocks.invoke.mockImplementation(async (command: string, args: { patch?: SettingsPatch }) => {
    if (command === 'settings_get') return structuredClone(disk);
      if (command === 'book_open') return openExample.result;
    if (command === 'settings_patch') {
      disk = mergePatch(disk, args.patch);
      return structuredClone(disk);
    }
    if (command === 'position_get') return mocks.current;
    if (command === 'txt_prepare') {
      prepares++;
      return txtExample.result;
    }
    return null;
  });
  const book = { ...openExample.result.book, format: 'txt' } as BookRecord;
  const render = (suspended: boolean) =>
    act(async () =>
      root.render(
        createElement(ReaderView, {
          book,
          onBack: back,
          onQuit: quit,
          saveRef,
          suspended,
        }),
      ),
    );
  await render(false);
  expect(prepares).toBe(1);
  await render(true);
  for (const size of [5000, 6000, 7000])
    await act(async () => useSettings.getState().patch({ txt: { fallbackChunkChars: size } }));
  expect(prepares).toBe(1); // nothing while Settings is open
  await render(false);
  expect(prepares).toBe(2); // once, with the last value
  expect(mocks.mount).toHaveBeenCalledTimes(2);
});

it('shows the fatal panel when a layout remount fails after teardown', async () => {
  await open();
  mocks.mount.mockRejectedValueOnce({ code: 'IO_ERROR', message: 'private mount detail' });
  await key('KeyD');
  expect(container.querySelector('.reader-error[role="alert"]')?.textContent).toContain('A file could not be read or written.');
  expect(container.textContent).not.toContain('private mount detail');
  expect(mocks.toast.error).not.toHaveBeenCalled();
});

it('exposes toolbar pinning and auto-scroll through More with live shortcuts', async () => {
  const frame = controlledFrames();
  await open();
  const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
  await act(async () => button('Keep toolbar visible').click());
  expect(button('Auto-hide toolbar')).toBeTruthy();
  await act(async () => button('Start auto-scroll').click());
  await frame(100);
  expect(mocks.scrollBy).toHaveBeenCalled();
  await act(async () => button('Stop auto-scroll').click());
  expect(button('Start auto-scroll')).toBeTruthy();
});
it('limits the preset accent to the margin bookmark layer', async () => {
  await open();
  await act(async () => useSettings.getState().patchStyle({ colors: { accent: '#123456' } }));
  const layer = container.querySelector<HTMLElement>('[data-bookmark-marks]')!;
  expect(layer.style.getPropertyValue('--accent')).toBe('#123456');
  expect(layer.parentElement?.style.getPropertyValue('--accent')).toBe('');
  expect(container.querySelector<HTMLElement>('.reader-mount')?.style.getPropertyValue('--accent')).toBe('');
});
it('does not register the saved sidebar after disposal during settings load', async () => {
  const { ReaderSession } = await import('./session/ReaderSession');
  const original = mocks.invoke.getMockImplementation()!;
  let release!: (settings: Settings) => void;
  mocks.invoke.mockImplementation(async (command: string, args: never) => command === 'settings_get'
    ? new Promise<Settings>((resolve) => { release = resolve; }) : original(command, args));
  const session = new ReaderSession(openExample.result.book as BookRecord, container, { onBack: back });
  await act(async () => session.start());
  session.dispose();
  disk.ui.tocOpen = true;
  await act(async () => release(disk));
  expect(overlays.snapshot()).toEqual([]);
  expect(mocks.invoke.mock.calls.some(([name]) => name === 'book_open')).toBe(false);
});
it('keeps chrome callbacks, command entries and footer stable on unchanged reading data', async () => {
  const { ReaderChrome } = await import('./ReaderChrome');
  const chrome = vi.mocked(ReaderChrome);
  await open();
  await act(async () => emit('relocate', { locator: { ...mocks.current }, reason: 'scroll' }));
  const before = chrome.mock.calls.at(-1)![0];
  await act(async () => emit('relocate', { locator: { ...mocks.current }, reason: 'scroll' }));
  const after = chrome.mock.calls.at(-1)![0];
  for (const prop of ['focusHome', 'onSurfacePress', 'footer', 'commands'] as const)
    expect(after[prop]).toBe(before[prop]);
});
it('retains a failed global TXT re-split for retry when Settings closes again', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  let prepares = 0;
  mocks.invoke.mockImplementation(async (command: string, args: never) => {
    if (command === 'txt_prepare') {
      if (++prepares === 2) throw { code: 'IO_ERROR', message: 'read failed' };
      return txtExample.result;
    }
    return original(command, args);
  });
  const book = { ...openExample.result.book, format: 'txt' } as BookRecord;
  const render = (suspended: boolean) => act(async () => root.render(createElement(ReaderView, { book, onBack: back, onQuit: quit, saveRef, suspended })));
  await render(false);
  await act(async () => useSettings.getState().patch({ txt: { fallbackChunkChars: 7000 } }));
  expect(prepares).toBe(2);
  expect(mocks.mount).toHaveBeenCalledOnce();
  await render(true);
  await render(false);
  expect(prepares).toBe(3);
  expect(mocks.mount).toHaveBeenCalledTimes(2);
  await render(true); await render(false);
  expect(prepares).toBe(3);
});
it('shows the fatal panel when a global TXT re-split cannot remount', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: never) => command === 'txt_prepare' ? txtExample.result : original(command, args));
  const book = { ...openExample.result.book, format: 'txt' } as BookRecord;
  await act(async () => root.render(createElement(ReaderView, { book, onBack: back, onQuit: quit, saveRef })));
  mocks.mount.mockRejectedValueOnce({ code: 'IO_ERROR', message: 'mount failed' });
  await act(async () => useSettings.getState().patch({ txt: { fallbackChunkChars: 7500 } }));
  expect(container.querySelector('.reader-error[role="alert"]')?.textContent).toContain('A file could not be read or written.');
});

it('keeps a chapter label and readout visible during a cold fragment measurement', async () => {
  const { ReaderChrome } = await import('./ReaderChrome');
  disk.chrome.footerProgress = 'chapter';
  const source = await epubSource('fixture');
  source.toc = [{ label: 'First chapter', href: 'one#first' }, { label: 'Subheading', href: 'one#second' }];
  let release!: (doc: Document) => void;
  source.sections = [{ ...source.sections[0]!, createDocument: () => new Promise<Document>((resolve) => { release = resolve; }) }];
  source.resolveHref = () => ({ index: 0, anchor: (doc) => doc.body });
  vi.mocked(epubSource).mockResolvedValueOnce(source);
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: never) => command === 'book_open'
    ? { ...openExample.result, epubMetrics: { fileHash: 'a'.repeat(64), sectionChars: [], tocFragmentOffsets: {} } }
    : original(command, args));
  const restored = { ...mocks.current, sectionIndex: 0, cfi: 'epubcfi(/6/2!/4/2/1:2)', charOffset: 2 };
  mocks.saved = restored;
  await open();
  const chrome = vi.mocked(ReaderChrome).mock.calls.at(-1)![0];
  expect(chrome.readout).toBe('Preparing chapters…');
  expect((chrome.title as React.ReactElement<{ chapter: string }>).props.chapter).toBe('First chapter');
  expect(mocks.mount).toHaveBeenCalledOnce();
  expect(mocks.mount.mock.calls[0]![3]).toEqual(restored);
  expect(container.textContent).not.toContain('Preparing reading progress');
  const bridge = vi.mocked(createRenderer).mock.calls[0]![1]!.locatorBridge!;
  expect(bridge.sectionChars?.()).toBeNull();
  // The user can keep reading while the measurement is pending; completion reads that live spot.
  const live = { ...restored, charOffset: 3, progress: 0.5, globalCharOffset: 3 };
  mocks.getLocator.mockReturnValue(live);
  await act(async () => vi.waitFor(() => expect(release).toBeTypeOf('function')));
  await act(async () => release(new DOMParser().parseFromString('<body>😀text</body>', 'text/html')));
  expect(mocks.mount).toHaveBeenCalledOnce();
  expect(mocks.goTo).not.toHaveBeenCalled();
  expect(bridge.sectionChars?.()).toEqual([6]);
  expect(container.textContent).toContain('50.0%');
  expect(vi.mocked(ReaderChrome).mock.calls.at(-1)![0].readout).not.toBe('Preparing chapters…');
});
it('does not consume a newer TXT settings edit while an older split is preparing', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  let prepares = 0;
  let release!: () => void;
  mocks.invoke.mockImplementation(async (command: string, args: never) => {
    if (command === 'txt_prepare') {
      if (++prepares === 2) await new Promise<void>((resolve) => { release = resolve; });
      return txtExample.result;
    }
    return original(command, args);
  });
  const book = { ...openExample.result.book, format: 'txt' } as BookRecord;
  await act(async () => root.render(createElement(ReaderView, { book, onBack: back, onQuit: quit, saveRef })));
  await act(async () => useSettings.getState().patch({ txt: { fallbackChunkChars: 6000 } }));
  expect(prepares).toBe(2);
  await act(async () => useSettings.getState().patch({ txt: { fallbackChunkChars: 6500 } }));
  await act(async () => release());
  expect(prepares).toBe(3);
  expect(mocks.mount).toHaveBeenCalledTimes(3);
});
