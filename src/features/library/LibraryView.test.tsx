// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BookRecord } from '@contract/types';
import { sampleBooks } from '../../dev/sampleBooks';

vi.mock('../../ui/TitleBar', () => ({ TitleBar: () => <div /> }));

import { LibraryView, type LibraryViewProps } from './LibraryView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

function render(books: BookRecord[], over: Partial<LibraryViewProps> = {}) {
  const props: LibraryViewProps = {
    books,
    view: 'grid',
    sort: 'title',
    sortDir: 'asc',
    filter: 'all',
    formatFilter: 'all',
    query: '',
    selection: [],
    importing: null,
    coverUrl: () => null,
    onViewChange: vi.fn(),
    onSortChange: vi.fn(),
    onFilterChange: vi.fn(),
    onFormatFilterChange: vi.fn(),
    onQueryChange: vi.fn(),
    onSelectionChange: vi.fn(),
    onOpen: vi.fn(),
    onRemove: vi.fn(),
    onAddBooks: vi.fn(),
    ...over,
  };
  act(() => root.render(<LibraryView {...props} />));
  return props;
}
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

it('renders the empty state with an Add Books button', () => {
  const p = render([]);
  expect(host.textContent).toContain('Your library is empty');
  expect(host.textContent).toContain('Drop EPUB or TXT files anywhere in this window, or');
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add Books')!;
  act(() => btn.click());
  expect(p.onAddBooks).toHaveBeenCalledOnce();
});

it('Enter opens the active book', () => {
  const books = sampleBooks(1_000_000_000_000).slice(0, 3);
  const p = render(books, { selection: [books[1]!.id] });
  key(host.querySelector('[role=listbox]')!, 'Enter');
  expect(p.onOpen).toHaveBeenCalledWith(books[1]!.id);
});

it('Delete asks for confirmation, then removes', () => {
  const books = sampleBooks(1_000_000_000_000).slice(0, 3);
  const p = render(books, { selection: [books[0]!.id] });
  key(host.querySelector('[role=listbox]')!, 'Delete');
  expect(p.onRemove).not.toHaveBeenCalled();
  const confirm = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent === 'Remove',
  )!;
  expect(confirm).toBeTruthy();
  act(() => confirm.click());
  expect(p.onRemove).toHaveBeenCalledWith([books[0]!.id]);
});
