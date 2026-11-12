import { errorCopy } from '../ipc/errorCopy';
import { create } from 'zustand';
import type { BookRecord, BookOpenResult, ImportDonePayload, LibrarySettings, LibrarySort } from '@contract/types';
import { toast } from 'sonner';
import { invoke } from '../ipc/commands';
import { listen } from '../ipc/events';
import { useSettings } from './settingsStore';
import type { FormatFilter } from '../features/library/libraryModel';

type Preferences = Pick<LibrarySettings, 'view' | 'sort' | 'sortDir' | 'filter'>;
export interface LibraryState extends Preferences {
  books: BookRecord[];
  opened: BookRecord | null;
  openedData: BookOpenResult | null;
  importing: { done: number; total: number } | null;
  selection: string[];
  query: string;
  formatFilter: FormatFilter;
  connect(): Promise<() => void>;
  refresh(): Promise<void>;
  importPaths(paths: string[]): Promise<void>;
  pickAndImport(): Promise<void>;
  remove(ids: string[]): Promise<void>;
  open(id: string): Promise<void>;
  close(): void;
  setView(view: Preferences['view']): void;
  setSort(sort: LibrarySort, sortDir: Preferences['sortDir']): void;
  setFilter(filter: Preferences['filter']): void;
  setFormatFilter(formatFilter: FormatFilter): void;
  setQuery(query: string): void;
  setSelection(selection: string[]): void;
}

const plurals = new Intl.PluralRules('en');
const noun = (n: number, word: string) => `${n} ${word}${plurals.select(n) === 'one' ? '' : 's'}`;
export function importSummary(result: ImportDonePayload): string {
  return [
    `Added ${noun(result.added, 'book')}`,
    `${noun(result.duplicates, 'duplicate')} skipped`,
    `${result.failed.length} failed`,
    ...(result.unsupported.length
      ? [`${result.unsupported.length} unsupported: ${result.unsupported.join(', ')}`]
      : []),
  ].join(' · ');
}

export function createLibraryStore(settings = useSettings) {
  let revision = 0;
  let request = 0;
  let opening = 0;
  const jobs = new Map<string, { done: number; total: number }>();
  return create<LibraryState>((set, get) => {
    const progress = () => {
      const values = [...jobs.values()];
      set({
        importing: values.length
          ? values.reduce((a, b) => ({ done: a.done + b.done, total: a.total + b.total }), {
              done: 0,
              total: 0,
            })
          : null,
      });
    };
    const upsert = (book: BookRecord) => {
      revision++;
      set({ books: [book, ...get().books.filter((b) => b.id !== book.id)] });
    };
    const preferences = (partial: Partial<Preferences>) => {
      settings.getState().setLibrary(partial);
      set(partial);
    };
    return {
      ...settings.getState().settings.library,
      books: [],
      opened: null,
      openedData: null,
      importing: null,
      selection: [],
      query: '',
      formatFilter: 'all',
      connect: async () => {
        const sync = () => {
          const { view, sort, sortDir, filter } = settings.getState().settings.library;
          set({ view, sort, sortDir, filter });
        };
        const stops = [settings.subscribe(sync)];
        sync();
        try {
          stops.push(
            await listen('import://item', (item) => {
              if (item.book) upsert(item.book);
              jobs.set(item.jobId, { done: item.index + 1, total: item.total });
              progress();
            }),
          );
          stops.push(
            await listen('import://done', (result) => {
              jobs.delete(result.jobId);
              progress();
              toast(importSummary(result));
              void get()
                .refresh()
                .catch((e: unknown) => toast.error(errorMessage(e)));
            }),
          );
          return () => stops.forEach((stop) => stop());
        } catch (e) {
          stops.forEach((stop) => stop());
          throw e;
        }
      },
      refresh: async () => {
        const current = ++request;
        const before = revision;
        const books = await invoke('library_list', {});
        if (current !== request) return;
        // An import/removal may finish while the list snapshot is in flight.
        if (before !== revision) return get().refresh();
        set({ books, selection: get().selection.filter((id) => books.some((b) => b.id === id)) });
      },
      importPaths: async (paths) => {
        if (!paths.length) return;
        const jobId = crypto.randomUUID();
        jobs.set(jobId, { done: 0, total: paths.length });
        progress();
        try {
          await invoke('library_import', { jobId, paths });
          // Completion events, which can precede this response, own the progress state.
        } catch (e) {
          jobs.delete(jobId);
          progress();
          throw e;
        }
      },
      pickAndImport: async () => get().importPaths(await invoke('dialog_pick_books', {})),
      remove: async (ids) => {
        if (!ids.length) return;
        const result = await invoke('library_remove', { bookIds: ids });
        revision++;
        const removed = new Set(result.removedIds);
        set({
          books: get().books.filter((b) => !removed.has(b.id)),
          selection: get().selection.filter((id) => !removed.has(id)),
        });
        if (result.fileErrors.length)
          toast.error('Books removed, but some library files could not be deleted.');
      },
      open: async (id) => {
        const attempt = ++opening;
        const result = await invoke('book_open', { bookId: id });
        if (attempt !== opening) return;
        upsert(result.book);
        set({ opened: result.book, openedData: result });
      },
      close: () => {
        opening++;
        set({ opened: null, openedData: null });
      },
      setView: (view) => preferences({ view }),
      setSort: (sort, sortDir) => preferences({ sort, sortDir }),
      setFilter: (filter) => preferences({ filter }),
      setFormatFilter: (formatFilter) => set({ formatFilter }),
      setQuery: (query) => set({ query }),
      setSelection: (selection) => set({ selection }),
    };
  });
}

/** #10: what the UI shows for a failure is the user copy for its ErrorCode, never its message. */
export const errorMessage = errorCopy;
export const useLibrary = createLibraryStore();
