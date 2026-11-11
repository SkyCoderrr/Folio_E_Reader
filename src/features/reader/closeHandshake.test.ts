// @vitest-environment jsdom
import { act, createElement, useEffect, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../App';
import openExample from '../../../contract/examples/book_open.json';
import { useLibrary } from '../../state/libraryStore';
import defaults from '../../../contract/settings.defaults.json';
import { useSettings } from '../../state/settingsStore';
const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  save: vi.fn<() => Promise<void>>(async () => undefined),
  close: undefined as (() => void) | undefined,
}));
vi.mock('../../ipc/commands', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock('../../ipc/events', () => ({
  listen: async (_: string, cb: () => void) => {
    if (_ === 'app://close-requested') mocks.close = cb;
    return () => {
      mocks.close = undefined;
    };
  },
}));
vi.mock('../../app/dragDrop', () => ({ listenForBookDrops: async () => () => undefined }));
vi.mock('../../dev/CaptionTestPage', () => ({ default: () => null }));
vi.mock('../../ui/TitleBar', () => ({ TitleBar: () => null }));
vi.mock('./ReaderView', () => ({
  ReaderView: ({ saveRef }: { saveRef: RefObject<(() => Promise<void>) | null> }) => {
    useEffect(() => {
      saveRef.current = mocks.save;
      return () => {
        saveRef.current = null;
      };
    }, [saveRef]);
    return null;
  },
}));
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  useSettings.setState({ loaded: false });
  useLibrary.setState({ opened: null, books: [] });
  mocks.invoke.mockImplementation(async (...args: unknown[]) =>
    args[0] === 'settings_get'
      ? structuredClone(defaults)
      : args[0] === 'library_list'
        ? [openExample.result.book]
        : args[0] === 'book_open'
          ? openExample.result
          : null,
  );
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  location.hash = '';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(App)));
  await act(async () => useLibrary.getState().open(openExample.result.book.id));
  mocks.invoke.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
it('awaits position flush before app_quit and coalesces duplicate native close requests', async () => {
  let release!: () => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    mocks.close?.();
    mocks.close?.();
  });
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => release());
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('app_quit', {});
});
it('bounds a stalled close flush at 1500 ms', async () => {
  vi.useFakeTimers();
  mocks.save.mockImplementationOnce(() => new Promise<void>(() => undefined));
  await act(async () => mocks.close?.());
  await act(async () => vi.advanceTimersByTimeAsync(1499));
  expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('app_quit', {});
});

it('still acknowledges quit when position flushing rejects', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.save.mockRejectedValueOnce(new Error('disk unavailable'));
  await act(async () => mocks.close?.());
  expect(warn).toHaveBeenCalledWith('Position flush failed', expect.any(Error));
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('app_quit', {});
  warn.mockRestore();
});
