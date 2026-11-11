import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  BookRecord,
  ImportDonePayload,
  ImportItemPayload,
  LibraryImportArgs,
  Settings,
  SettingsPatch,
} from '@contract/types';
import defaults from '../../contract/settings.defaults.json';
import example from '../../contract/examples/book_open.json';
import { createSettingsStore } from './settingsStore';
import { createLibraryStore, importSummary } from './libraryStore';
import { mergePatch } from './appearance';

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
  item: undefined as ((p: ImportItemPayload) => void) | undefined,
  done: undefined as ((p: ImportDonePayload) => void) | undefined,
  stop: vi.fn(),
}));
vi.mock('../ipc/commands', () => ({ invoke: ipc.invoke }));
vi.mock('../ipc/events', () => ({
  listen: async (name: string, cb: never) => {
    if (name === 'import://item') ipc.item = cb;
    if (name === 'import://done') ipc.done = cb;
    return ipc.stop;
  },
}));
vi.mock('sonner', () => ({ toast: Object.assign(ipc.toast, { error: ipc.error }) }));
const book = example.result.book as BookRecord;
let disk: Settings;
let books: BookRecord[];
let settings: ReturnType<typeof createSettingsStore>;
let store: ReturnType<typeof createLibraryStore>;
let stop: () => void;
const item = (jobId: string): ImportItemPayload => ({
  jobId,
  index: 0,
  total: 1,
  path: book.filePath,
  fileName: book.fileName,
  outcome: 'added',
  book,
  error: null,
});
const done = (jobId: string): ImportDonePayload => ({
  jobId,
  total: 1,
  added: 1,
  duplicates: 0,
  unsupported: [],
  failed: [],
});
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  books = [];
  disk = structuredClone(defaults) as Settings;
  ipc.invoke.mockImplementation(
    async (name: string, args: { patch?: SettingsPatch; bookIds?: string[] }) => {
      if (name === 'settings_get') return structuredClone(disk);
      if (name === 'settings_patch') {
        disk = mergePatch(disk, args.patch);
        return structuredClone(disk);
      }
      if (name === 'library_list') return [...books];
      if (name === 'book_open') return example.result;
      if (name === 'library_remove') return { removedIds: args.bookIds, fileErrors: [] };
      return null;
    },
  );
  settings = createSettingsStore();
  store = createLibraryStore(settings);
  stop = await store.getState().connect();
  await settings.getState().load();
});
afterEach(() => {
  stop();
  vi.clearAllTimers();
  vi.useRealTimers();
});
it('registers listeners before import, applies items immediately and refreshes/toasts on done before acceptance resolves', async () => {
  let release!: () => void;
  ipc.invoke.mockImplementationOnce((_name: string, args: LibraryImportArgs) => {
    expect(ipc.item).toBeTypeOf('function');
    ipc.item!(item(args.jobId));
    expect(store.getState().books).toEqual([book]);
    expect(store.getState().importing).toEqual({ done: 1, total: 1 });
    books = [book];
    ipc.done!(done(args.jobId));
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const importing = store.getState().importPaths([book.filePath]);
  expect(store.getState().importing).toBeNull();
  release();
  await importing;
  expect(store.getState().books).toEqual([book]);
  expect(ipc.invoke).toHaveBeenCalledWith('library_list', {});
  expect(ipc.toast).toHaveBeenCalledWith('Added 1 book · 0 duplicates skipped · 0 failed');
});
it('picker cancellation does not import; selected paths get a unique job id and rejected jobs clear progress', async () => {
  ipc.invoke.mockResolvedValueOnce([]);
  await store.getState().pickAndImport();
  expect(ipc.invoke.mock.calls.filter(([name]) => name === 'library_import')).toHaveLength(0);
  ipc.invoke.mockResolvedValueOnce([book.filePath]);
  await store.getState().pickAndImport();
  expect(ipc.invoke).toHaveBeenCalledWith('library_import', {
    jobId: expect.any(String),
    paths: [book.filePath],
  });
  ipc.done!(done(ipc.invoke.mock.calls.find(([name]) => name === 'library_import')![1].jobId));
  ipc.invoke.mockRejectedValueOnce(new Error('DB unavailable'));
  await expect(store.getState().importPaths([book.filePath])).rejects.toThrow('DB unavailable');
  expect(store.getState().importing).toBeNull();
});
it('removes only acknowledged ids and clears their selection', async () => {
  books = [book];
  await store.getState().refresh();
  store.getState().setSelection([book.id]);
  await store.getState().remove([book.id]);
  expect(ipc.invoke).toHaveBeenCalledWith('library_remove', { bookIds: [book.id] });
  expect(store.getState().books).toEqual([]);
  expect(store.getState().selection).toEqual([]);
});
it('persists view/sort/direction/filter through the serialized settings writer while keeping search/format in memory', async () => {
  store.getState().setView('list');
  store.getState().setSort('title', 'asc');
  store.getState().setFilter('reading');
  store.getState().setQuery('Tale');
  store.getState().setFormatFilter('epub');
  await settings.getState().flush();
  expect(disk.library).toMatchObject({
    view: 'list',
    sort: 'title',
    sortDir: 'asc',
    filter: 'reading',
  });
  const reloadedSettings = createSettingsStore();
  await reloadedSettings.getState().load();
  const reopened = createLibraryStore(reloadedSettings);
  expect(reopened.getState()).toMatchObject({
    view: 'list',
    sort: 'title',
    sortDir: 'asc',
    filter: 'reading',
    query: '',
    formatFilter: 'all',
  });
  expect(ipc.invoke).toHaveBeenCalledWith('settings_patch', {
    patch: { library: { view: 'list', sort: 'title', sortDir: 'asc', filter: 'reading' } },
  });
});
it('opens the returned BookRecord for EPUB and TXT', async () => {
  await store.getState().open(book.id);
  expect(store.getState().opened).toEqual(book);
  store.getState().close();
  expect(store.getState().opened).toBeNull();
  store.setState({ books: [{ ...book, format: 'txt' }] });
  ipc.invoke.mockResolvedValueOnce({
    book: { ...book, format: 'txt' },
    locator: null,
    txtPrefs: null,
  });
  await store.getState().open(book.id);
  expect(store.getState().opened?.format).toBe('txt');
});
it('does not overwrite an import item with an older in-flight list snapshot', async () => {
  let release!: (books: BookRecord[]) => void;
  ipc.invoke.mockImplementationOnce(
    () =>
      new Promise<BookRecord[]>((resolve) => {
        release = resolve;
      }),
  );
  const refresh = store.getState().refresh();
  ipc.item!(item('race'));
  books = [book];
  release([]);
  await refresh;
  expect(store.getState().books).toEqual([book]);
});
it('uses singular and plural import result wording, including failures and unsupported files', () => {
  expect(
    importSummary({ ...done('summary'), added: 2, duplicates: 1, unsupported: ['x.pdf'] }),
  ).toBe('Added 2 books · 1 duplicate skipped · 0 failed · 1 unsupported: x.pdf');
});
