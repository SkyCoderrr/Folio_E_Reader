// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TocItem } from '../../engine/book/BookSource';
import { TocSidebar, type TocSidebarProps } from './TocSidebar';
import { buildTocSpans, classifyToc, type TocBookInfo, type TocPosition } from './tocModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toc: TocItem[] = [
  { label: 'A', href: 'a', subitems: [{ label: 'A1', href: 'a1', subitems: [{ label: 'A1x', href: 'a1x' }] }] },
  { label: 'B', href: 'b' },
];

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
});

const hrefs = (items: TocItem[]): string[] => items.flatMap((i) => [i.href, ...hrefs(i.subitems ?? [])]);
/** Test inputs: a TocBookInfo + position (or just the current href), turned into spans + reading. */
type Over = Partial<TocSidebarProps> & { tocBook?: TocBookInfo; position?: TocPosition; currentHref?: string | null };
function render({ tocBook, position, currentHref = 'b', ...over }: Over = {}) {
  const t = over.toc ?? toc;
  const all = hrefs(t);
  const book: TocBookInfo = tocBook ?? {
    resolve: (h) => (all.includes(h) ? all.indexOf(h) : null),
    weights: all.map(() => 100),
    chapterKey: (s, h) => `${s}${h}`,
  };
  const spans = buildTocSpans(t, book);
  const at = position ?? (currentHref ? { sectionIndex: all.indexOf(currentHref), progress: 0 } : null);
  const props: TocSidebarProps = {
    open: true,
    animate: false,
    tab: 'contents',
    onTabChange: vi.fn(),
    toc: t,
    spans,
    reading: classifyToc(spans, at),
    onNavigate: vi.fn(),
    bookmarks: [{ id: '1', label: 'Ch 1', excerpt: 'text', progress: 0.5, createdAt: new Date().toISOString() }],
    onBookmarkOpen: vi.fn(),
    onBookmarkDelete: vi.fn(),
    ...over,
  };
  act(() => root.render(createElement(TocSidebar, props)));
  return props;
}

const labels = () => [...host.querySelectorAll('[role="treeitem"]')].map((e) => e.textContent);

it('renders a tree with the current row marked and deeper levels collapsed', () => {
  render();
  expect(host.querySelector('[role="tree"]')).not.toBeNull();
  expect(host.querySelector('[aria-current="true"]')?.textContent).toBe('B0%');
  expect(labels()).toEqual(['A', 'A1', 'B0%']);
});

it('Enter navigates the focused row', () => {
  const p = render();
  const row = host.querySelector<HTMLElement>('[aria-current="true"]')!;
  act(() => {
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(p.onNavigate).toHaveBeenCalledWith('b');
});

it('ArrowRight expands a collapsed row', () => {
  render({ currentHref: null });
  const a1 = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((e) => e.textContent === 'A1')!;
  act(() => a1.focus());
  act(() => {
    a1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(labels()).toContain('A1x');
});

it('bookmark delete button calls onBookmarkDelete', () => {
  const p = render({ tab: 'bookmarks' });
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label^="Delete bookmark"]')!.click());
  expect(p.onBookmarkDelete).toHaveBeenCalledWith('1');
});

// ── t29u: visit memory styling ──
const book5 = (format: 'epub' | 'txt'): { toc: TocItem[]; tocBook: TocBookInfo } => ({
  toc: [0, 1, 2, 3, 4].map((i) => ({ label: `C${i}`, href: `s${i}` })),
  tocBook: {
    resolve: (h) => Number(h.slice(1)),
    weights: Array(5).fill(100),
    chapterKey: (s) => (format === 'txt' ? `t:${s}` : `s:${s}#`),
  },
});
const rowState = () =>
  [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((e) =>
    e.dataset.current === 'true' ? 'current' : e.dataset.read === 'true' ? 'read' : 'unread',
  );

it.each(['epub', 'txt'] as const)(
  '%s: last-read chapter accent + one %; other visited muted; skipped unread',
  (fmt) => {
    const { toc: t, tocBook } = book5(fmt);
    const key = (i: number) => (fmt === 'txt' ? `t:${i}` : `s:${i}#`);
    render({
      toc: t,
      tocBook,
      currentHref: null,
      position: { sectionIndex: 3, progress: 0.7 },
      readKeys: new Set([key(0), key(3), key(4)]), // 1 and 2 were skipped
    });
    expect(rowState()).toEqual(['read', 'unread', 'unread', 'current', 'read']);
    const pcts = host.querySelectorAll('[title="Progress in this chapter"]');
    expect(pcts).toHaveLength(1);
    expect(host.querySelector('[aria-current="true"]')?.contains(pcts[0])).toBe(true);
  },
);

it('the current chapter keeps the current treatment even when it was read before', () => {
  const { toc: t, tocBook } = book5('epub');
  render({ toc: t, tocBook, currentHref: null, position: { sectionIndex: 1, progress: 0.3 }, readKeys: new Set(['s:1#']) });
  expect(rowState()[1]).toBe('current');
});

it('no memory yet: nothing muted, exactly one %', () => {
  const { toc: t, tocBook } = book5('epub');
  render({ toc: t, tocBook, currentHref: null, position: { sectionIndex: 2, progress: 0.5 } });
  expect(rowState()).toEqual(['unread', 'unread', 'current', 'unread', 'unread']);
  expect(host.querySelectorAll('[title="Progress in this chapter"]')).toHaveLength(1);
});

// ── t32u: several chapters in one spine section (differ only by #fragment) ──
it('fragments: the measured entry is current; while measuring no row is current (no section-level guess)', () => {
  const t: TocItem[] = [
    { label: 'Title', href: 's0' },
    { label: 'I', href: 's1#c1' },
    { label: 'II', href: 's1#c2' },
    { label: 'V', href: 's1#c5' },
    { label: 'VI', href: 's2' },
  ];
  const base: TocBookInfo = {
    resolve: (h) => Number(h.slice(1, 2)),
    weights: [50, 900, 100],
    chapterKey: (s, h) => `s:${s}#${h.split('#')[1] ?? ''}`,
  };
  const position = { sectionIndex: 1, charOffset: 700, progress: 750 / 1050 }; // V spans 600..900
  const readKeys = new Set(['s:1#c1']); // I read, II skipped
  // the reader's section-level href (first entry of section 1) must not be used as a fallback
  render({ toc: t, tocBook: { ...base, pending: true }, currentHref: 's1#c1', position, readKeys });
  expect(rowState()).toEqual(['unread', 'read', 'unread', 'unread', 'unread']);
  expect(host.querySelectorAll('[title="Progress in this chapter"]')).toHaveLength(0);
  const offsets = new Map([['s1#c1', 0], ['s1#c2', 300], ['s1#c5', 600]]);
  render({ toc: t, tocBook: { ...base, offsets }, currentHref: 's1#c1', position, readKeys });
  expect(rowState()).toEqual(['unread', 'read', 'unread', 'current', 'unread']);
  expect(host.querySelector('[aria-current="true"] [title="Progress in this chapter"]')?.textContent).toBe('33%');
});
