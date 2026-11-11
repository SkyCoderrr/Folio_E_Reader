import { formatTimeLeft } from '../stats/format';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Settings as SettingsIcon, Check, ChevronDown, Ellipsis, Search } from 'lucide-react';
import type { BookRecord, LibrarySort } from '@contract/types';
import { Button, Dialog, DialogClose, Menu, Segmented } from '../../ui/kit';
import type { MenuEntry } from '../../ui/Menu';
import { IconButton } from '../../ui/IconButton';
import { useSettings } from '../../state/settingsStore';
import { installKeyRouter } from '../../engine/input/keyRouter';
import { effectiveKeymap, eventChord } from '../../engine/input/keymap';
import { TitleBar } from '../../ui/TitleBar';
import { BookCover } from './BookCover';
import { ContextMenu, type CtxItem } from './ContextMenu';
import {
  defaultSortDir,
  formatLastRead,
  isFinished,
  isNew,
  progressPercent,
  visibleBooks,
  type FormatFilter,
  type ProgressFilter,
  type SortDir,
} from './libraryModel';
import styles from './LibraryView.module.css';

export interface LibraryViewProps {
  libraryOffline?: boolean;
  books: BookRecord[];
  view: 'grid' | 'list';
  /** ms of reading left per book id; absent until 5 active minutes (ST-05). */
  timeLeftMs?: Record<string, number>;
  sort: LibrarySort;
  sortDir: SortDir;
  filter: ProgressFilter;
  formatFilter: FormatFilter;
  query: string;
  selection: string[];
  importing: { done: number; total: number } | null;
  coverUrl(book: BookRecord): string | null;
  onViewChange(view: 'grid' | 'list'): void;
  onSortChange(sort: LibrarySort, dir: SortDir): void;
  /**
   * List-header click (LIB-05.1). Always called; for columns with a contract sort the view also
   * calls onSortChange. Format and Time left have no LibrarySort value: wire this to sort them
   * (their headers are disabled while this is absent).
   */
  onSort?(column: LibraryColumn): void;
  onFilterChange(filter: ProgressFilter): void;
  onFormatFilterChange(format: FormatFilter): void;
  onQueryChange(query: string): void;
  onSelectionChange(ids: string[]): void;
  onOpen(id: string): void;
  onRemove(ids: string[]): void;
  onAddBooks(): void;
  onSettings?(): void;
  onStats?(): void;
  onEncoding?(id: string): void;
  onChapterDetection?(id: string): void;
}

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'lastRead', label: 'Last read' },
  { value: 'added', label: 'Date added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'progress', label: 'Progress' },
];
const FILTERS: { value: ProgressFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'reading', label: 'Reading' },
  { value: 'unread', label: 'Unread' },
  { value: 'finished', label: 'Finished' },
];
const FORMATS: { value: FormatFilter; label: string }[] = [
  { value: 'epub', label: 'EPUB' },
  { value: 'txt', label: 'TXT' },
];

/** LIB-05.1 columns after the small cover. `sort` is the contract sort a header click selects. */
export type LibraryColumn =
  | 'title'
  | 'author'
  | 'format'
  | 'progress'
  | 'lastRead'
  | 'added'
  | 'timeLeft';
const COLUMNS: { id: LibraryColumn; label: string; sort?: LibrarySort }[] = [
  { id: 'title', label: 'Title', sort: 'title' },
  { id: 'author', label: 'Author', sort: 'author' },
  { id: 'format', label: 'Format' },
  { id: 'progress', label: 'Progress', sort: 'progress' },
  { id: 'lastRead', label: 'Last read', sort: 'lastRead' },
  { id: 'added', label: 'Added', sort: 'added' },
  { id: 'timeLeft', label: 'Time left' },
];
/** Client-side sort for the list columns without a contract value; books without data go last. */
export function sortClient(
  rows: BookRecord[],
  col: 'format' | 'timeLeft',
  dir: SortDir,
  timeLeftMs: Record<string, number> = {},
): BookRecord[] {
  const m = dir === 'asc' ? 1 : -1;
  const out = [...rows];
  if (col === 'format') return out.sort((a, b) => m * a.format.localeCompare(b.format));
  return out.sort((a, b) => {
    const x = timeLeftMs[a.id], y = timeLeftMs[b.id];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    return m * (x - y);
  });
}
const flipDir = (d: SortDir): SortDir => (d === 'asc' ? 'desc' : 'asc');
const formatAdded = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function Progress({ book }: { book: BookRecord }) {
  if (book.fileMissing) return <span className={styles.missing}>File missing</span>;
  if (isFinished(book)) {
    return (
      <>
        <span className={styles.bar} aria-hidden>
          <span className={styles.barFill} style={{ width: '100%', display: 'block' }} />
        </span>
        <Check size={14} className={styles.check} aria-label="Finished" />
      </>
    );
  }
  if (isNew(book)) return <span className={styles.badge}>New</span>;
  const pct = progressPercent(book);
  return (
    <>
      <span className={styles.bar} role="progressbar" aria-label="Progress" aria-valuenow={pct}>
        <span className={styles.barFill} style={{ width: `${pct}%`, display: 'block' }} />
      </span>
      <span>{pct}%</span>
    </>
  );
}

export function LibraryView(props: LibraryViewProps) {
  const {
    books,
    view,
    timeLeftMs,
    sort,
    sortDir,
    filter,
    formatFilter,
    query,
    selection,
    importing,
    coverUrl,
    onViewChange,
    onSortChange,
    onSort,
    onFilterChange,
    onFormatFilterChange,
    onQueryChange,
    onSelectionChange,
    onOpen,
    onRemove,
    onAddBooks,
    onEncoding,
    onChapterDetection,
  } = props;

  // Format and Time left have no contract LibrarySort: they sort client-side (PM decision).
  const [clientSort, setClientSort] = useState<{ col: 'format' | 'timeLeft'; dir: SortDir } | null>(null);
  const shown = useMemo(() => {
    const rows = visibleBooks(books, { sort, sortDir, filter, formatFilter, query });
    return clientSort ? sortClient(rows, clientSort.col, clientSort.dir, timeLeftMs) : rows;
  }, [books, sort, sortDir, filter, formatFilter, query, clientSort, timeLeftMs]);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string[] | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const selected = useMemo(() => new Set(selection), [selection]);
  const activeId = selection.length ? selection[selection.length - 1]! : null;

  useEffect(
    () =>
      installKeyRouter(window, {
        scopes: () =>
          document.querySelector('[data-settings-screen], [role="dialog"], [role="alertdialog"]')
            ? []
            : ['library'],
        bindings: () => useSettings.getState().settings.keybindings,
        handle: (action, phase) => {
          if (phase === 'up') return true;
          switch (action) {
            case 'library.search':
              searchRef.current?.focus();
              searchRef.current?.select();
              break;
            case 'library.viewGrid':
              onViewChange('grid');
              break;
            case 'library.viewList':
              onViewChange('list');
              break;
            case 'library.import':
              onAddBooks();
              break;
            case 'library.open':
              if (activeId) onOpen(activeId);
              break;
            case 'library.remove':
              if (selection.length) setPendingRemove(selection);
              break;
            case 'library.selectAll':
              onSelectionChange(shown.map((b) => b.id));
              break;
            default:
              return false;
          }
          return true;
        },
      }),
    [onViewChange, onAddBooks, activeId, onOpen, selection, onSelectionChange, shown],
  );

  useEffect(() => {
    if (!activeId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const columns = (): number => {
    const kids = gridRef.current?.children;
    if (view !== 'grid' || !kids || kids.length === 0) return 1;
    const top = (kids[0] as HTMLElement).offsetTop;
    let n = 0;
    while (n < kids.length && (kids[n] as HTMLElement).offsetTop === top) n++;
    return Math.max(1, n);
  };

  const select = (id: string, extend: boolean) => {
    if (extend && anchor.current) {
      const a = shown.findIndex((b) => b.id === anchor.current);
      const i = shown.findIndex((b) => b.id === id);
      if (a >= 0 && i >= 0) {
        const [lo, hi] = a < i ? [a, i] : [i, a];
        const ids = shown.slice(lo, hi + 1).map((b) => b.id);
        // Keep the focused end last so it stays the active item.
        onSelectionChange(a < i ? ids : ids.reverse());
        return;
      }
    }
    anchor.current = id;
    onSelectionChange([id]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || shown.length === 0) return;
    const bindings = useSettings.getState().settings.keybindings;
    if (
      e.code &&
      Object.entries(effectiveKeymap(bindings)).some(
        ([action, chords]) =>
          action.startsWith('library.') && chords.includes(eventChord(e.nativeEvent)),
      )
    )
      return;
    if (e.code && ['Enter', 'Delete', 'KeyA'].includes(e.code)) return;
    const idx = activeId ? shown.findIndex((b) => b.id === activeId) : -1;
    const go = (to: number) => {
      e.preventDefault();
      const next = shown[Math.max(0, Math.min(shown.length - 1, to))]!;
      select(next.id, e.shiftKey);
    };
    const cols = columns();
    switch (e.key) {
      case 'ArrowRight':
        return view === 'grid' ? go(idx + 1) : undefined;
      case 'ArrowLeft':
        return view === 'grid' ? go(idx - 1) : undefined;
      case 'ArrowDown':
        return go(idx < 0 ? 0 : idx + cols);
      case 'ArrowUp':
        return go(idx < 0 ? 0 : idx - cols);
      case 'Home':
        return go(0);
      case 'End':
        return go(shown.length - 1);
      case 'Enter':
        if (activeId) {
          e.preventDefault();
          onOpen(activeId);
        }
        return;
      case 'Delete':
        if (selection.length) {
          e.preventDefault();
          setPendingRemove(selection);
        }
        return;
      case 'a':
      case 'A':
        if (e.ctrlKey) {
          e.preventDefault();
          onSelectionChange(shown.map((b) => b.id));
        }
        return;
      case 'ContextMenu':
      case 'F10': {
        if (e.key === 'F10' && !e.shiftKey) return;
        if (!activeId) return;
        e.preventDefault();
        const el = listRef.current?.querySelector<HTMLElement>(
          `[data-book-id="${CSS.escape(activeId)}"]`,
        );
        const r = el?.getBoundingClientRect();
        setMenu({ x: (r?.left ?? 0) + 24, y: (r?.top ?? 0) + 24, ids: selection });
        return;
      }
    }
  };

  const onItemClick = (e: MouseEvent, id: string) => {
    if (e.ctrlKey || e.metaKey) {
      anchor.current = id;
      onSelectionChange(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    } else {
      select(id, e.shiftKey);
    }
  };

  const openMenuFor = (id: string, x: number, y: number) => {
    const ids = selected.has(id) ? selection : [id];
    if (!selected.has(id)) select(id, false);
    setMenu({ x, y, ids });
  };

  const menuItems = (ids: string[]): CtxItem[] => {
    const items: CtxItem[] = [];
    const only = ids.length === 1 ? books.find((b) => b.id === ids[0]) : undefined;
    if (only && only.format === 'txt') {
      if (onEncoding) items.push({ label: 'Text Encoding…', onSelect: () => onEncoding(only.id) });
      if (onChapterDetection)
        items.push({ label: 'Chapter Detection…', onSelect: () => onChapterDetection(only.id) });
    }
    items.push({ label: 'Remove…', danger: true, onSelect: () => setPendingRemove(ids) });
    return items;
  };

  const sortEntries: MenuEntry[] = [
    ...SORTS.map((s): MenuEntry => ({
      label: `${sort === s.value ? '✓ ' : ' '}${s.label}`,
      onSelect: () => {
        setClientSort(null);
        onSortChange(s.value, sort === s.value ? sortDir : defaultSortDir(s.value));
      },
    })),
    { type: 'separator' },
    ...(['asc', 'desc'] as const).map((d): MenuEntry => ({
      label: `${sortDir === d ? '✓ ' : ' '}${d === 'asc' ? 'Ascending' : 'Descending'}`,
      onSelect: () => {
        setClientSort(null);
        onSortChange(sort, d);
      },
    })),
  ];

  const pendingBooks = pendingRemove
    ? pendingRemove.map((id) => books.find((b) => b.id === id)).filter((b): b is BookRecord => !!b)
    : [];
  const removeTitle =
    pendingBooks.length === 1
      ? `Remove “${pendingBooks[0]!.title}”?`
      : `Remove ${pendingBooks.length} books?`;

  const moreButton = (b: BookRecord, cls: string) => (
    <button
      type="button"
      className={`${styles.more} ${cls}`}
      aria-label={`More actions for ${b.title}`}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        openMenuFor(b.id, r.left, r.bottom + 4);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Ellipsis size={16} />
    </button>
  );

  const itemProps = (b: BookRecord) => ({
    role: 'option' as const,
    'aria-selected': selected.has(b.id),
    'data-book-id': b.id,
    'data-active': b.id === activeId,
    'data-menu': menu?.ids.length === 1 && menu.ids[0] === b.id,
    onClick: (e: MouseEvent) => onItemClick(e, b.id),
    onDoubleClick: () => onOpen(b.id),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      openMenuFor(b.id, e.clientX, e.clientY);
    },
  });

  const empty = books.length === 0;

  return (
    <div className={styles.screen}>
      <TitleBar
        title="Folio"
        actions={
          <>
            <Button variant="ghost" onClick={props.onStats}>
              Reading stats
            </Button>
            <IconButton label="Settings" action="settings.open" onClick={props.onSettings}>
              <SettingsIcon size={20} />
            </IconButton>
          </>
        }
      />
      <main className={styles.main}>
        {props.libraryOffline && <p role="status">The library folder is unavailable.</p>}
        <div className={styles.header}>
          <h1 className={styles.title}>Library</h1>
          <div className={styles.search}>
            <Search size={16} className={styles.searchIcon} aria-hidden />
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder="Search title or author"
              aria-label="Search title or author"
              aria-keyshortcuts="Control+F"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (query) onQueryChange('');
                  else listRef.current?.focus();
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  listRef.current?.focus();
                }
              }}
            />
            <span className={styles.searchHint}>Ctrl+F</span>
          </div>
          <Segmented
            label="View"
            value={view}
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'list', label: 'List' },
            ]}
            onChange={onViewChange}
          />
          <Menu
            trigger={
              <Button aria-label="Sort">
                Sort
                <ChevronDown size={16} />
              </Button>
            }
            items={sortEntries}
          />
          {!empty && (
            <Button variant="primary" onClick={onAddBooks} aria-keyshortcuts="Control+O">
              Add Books
            </Button>
          )}
        </div>

        {!empty && (
          <div className={styles.filters}>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={styles.chip}
                aria-pressed={filter === f.value}
                onClick={() => onFilterChange(f.value)}
              >
                {f.label}
              </button>
            ))}
            <span className={styles.filterGap} />
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={styles.chip}
                aria-pressed={formatFilter === f.value}
                onClick={() => onFormatFilterChange(formatFilter === f.value ? 'all' : f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {importing && (
          <div className={styles.importing} role="status">
            <span>
              Importing {Math.min(importing.done + 1, importing.total)} of {importing.total}…
            </span>
            <span className={styles.bar}>
              <span
                className={styles.barFill}
                style={{
                  width: `${importing.total ? (importing.done / importing.total) * 100 : 0}%`,
                  display: 'block',
                }}
              />
            </span>
          </div>
        )}

        {empty ? (
          <section className={styles.empty} aria-labelledby="lib-empty">
            <h2 id="lib-empty" className={styles.emptyTitle}>
              Your library is empty
            </h2>
            <p className={styles.emptyBody}>Drop EPUB or TXT files anywhere in this window, or</p>
            <Button variant="primary" onClick={onAddBooks}>
              Add Books
            </Button>
          </section>
        ) : (
          // TODO(M3 follow-up): virtualize with react-virtuoso once installed (PRD 5.5 FR-LIB-2).
          <div
            ref={listRef}
            className={styles.scroll}
            role="listbox"
            aria-label="Books"
            aria-multiselectable
            aria-activedescendant={undefined}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onClick={(e) => {
              if (e.target === e.currentTarget || e.target === gridRef.current)
                onSelectionChange([]);
            }}
          >
            {shown.length === 0 ? (
              <p className={styles.noMatch}>No books match.</p>
            ) : view === 'grid' ? (
              <div ref={gridRef} className={styles.grid}>
                {shown.map((b) => (
                  <div key={b.id} className={styles.card} {...itemProps(b)}>
                    <BookCover book={b} url={coverUrl(b)} className={styles.cover} />
                    {moreButton(b, styles.cardMore!)}
                    <div className={styles.bookTitle} title={b.title}>
                      {b.title}
                    </div>
                    <div className={styles.author}>{b.author ?? 'Unknown author'}</div>
                    <div className={styles.meta}>
                      <Progress book={b} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div ref={gridRef}>
                <div className={`${styles.row} ${styles.listHead}`} role="presentation">
                  <span />
                  {COLUMNS.map((c) => {
                    const active = clientSort ? clientSort.col === c.id : c.sort !== undefined && c.sort === sort;
                    const dir = clientSort ? clientSort.dir : sortDir;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={styles.headBtn}
                        tabIndex={-1}
                        data-active={active}
                        aria-label={`Sort by ${c.label}`}
                        disabled={false}
                        onClick={() => {
                          onSort?.(c.id);
                          if (c.sort !== undefined) {
                            setClientSort(null);
                            onSortChange(c.sort, active ? flipDir(sortDir) : defaultSortDir(c.sort));
                          } else {
                            const col = c.id as 'format' | 'timeLeft';
                            setClientSort((cs) => ({ col, dir: cs?.col === col ? flipDir(cs.dir) : 'asc' }));
                          }
                        }}
                      >
                        {c.label}
                        {active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    );
                  })}
                  <span />
                </div>
                {shown.map((b) => (
                  <div key={b.id} className={styles.row} {...itemProps(b)}>
                    <BookCover
                      book={b}
                      url={coverUrl(b)}
                      className={`${styles.cover} ${styles.thumb}`}
                    />
                    <span className={`${styles.rowTitle} ${styles.ellipsis}`} title={b.title}>
                      {b.title}
                    </span>
                    <span className={`${styles.cellMuted} ${styles.ellipsis}`}>
                      {b.author ?? '—'}
                    </span>
                    <span className={styles.cellMuted}>{b.format.toUpperCase()}</span>
                    <span className={styles.meta}>
                      <Progress book={b} />
                    </span>
                    <span className={styles.cellMuted}>{formatLastRead(b.lastOpenedAt)}</span>
                    <span className={styles.cellMuted}>{formatAdded(b.addedAt)}</span>
                    <span className={styles.cellMuted}>
                      {formatTimeLeft(timeLeftMs?.[b.id] ?? null)}
                    </span>
                    {moreButton(b, styles.rowMore!)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ids)} onClose={closeMenu} />
      )}

      <Dialog
        open={pendingRemove !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRemove(null);
        }}
        title={removeTitle}
        description="This deletes the library copy and its reading position, bookmarks and settings. It can’t be undone."
        actions={
          <>
            <DialogClose>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingRemove) onRemove(pendingRemove);
                setPendingRemove(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </div>
  );
}
