import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import type { TocItem } from '../../engine/book/BookSource';
import { ancestorsOf, defaultExpanded, flattenToc, type TocReading, type TocSpan } from './tocModel';
import styles from './toc.module.css';

export interface BookmarkRowData {
  id: string;
  label: string;
  excerpt: string;
  progress: number; // 0..1
  createdAt: string;
}

export interface TocSidebarProps {
  open: boolean;
  animate: boolean;
  tab: 'contents' | 'bookmarks';
  onTabChange: (tab: 'contents' | 'bookmarks') => void;
  toc: TocItem[];
  /** t24u: entry spans (chapter keys) and the reader's one current-chapter reading (#14). */
  spans: readonly TocSpan[];
  reading: TocReading;
  /** t29u: persisted chapterKeys of every chapter the reader has been in (visit memory). */
  readKeys?: ReadonlySet<string>;
  onNavigate: (href: string) => void;
  bookmarks: readonly BookmarkRowData[];
  onBookmarkOpen: (id: string) => void;
  onBookmarkDelete: (id: string) => void;
  /**
   * NAV-02.1: `overlay` (< 1280 px) floats over the text; `push` (>= 1280 px) expects the host to
   * shift the text column by `--sidebar-width` (300 px, defined in tokens.css). Default: overlay.
   */
  mode?: SidebarMode;
}

export type SidebarMode = 'overlay' | 'push';
export const SIDEBAR_PUSH_MIN_WIDTH = 1280;
/** Mode for a given window width (>= 1280 pushes, below overlays). */
export const sidebarModeFor = (windowWidth: number): SidebarMode =>
  windowWidth >= SIDEBAR_PUSH_MIN_WIDTH ? 'push' : 'overlay';

const DAY_MS = 86_400_000;
/** NAV-05.2: relative for the first 7 days, absolute date afterwards. */
export function bookmarkDate(iso: string, now: number = Date.now(), locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const age = now - d.getTime();
  if (age <= 7 * DAY_MS) {
    const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (age < 60_000) return f.format(0, 'second');
    if (age < 3_600_000) return f.format(-Math.floor(age / 60_000), 'minute');
    if (age < DAY_MS) return f.format(-Math.floor(age / 3_600_000), 'hour');
    return f.format(-Math.floor(age / DAY_MS), 'day');
  }
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

const pct = (p: number) => `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;

/** Memoised; its tab content is rendered only while open (N3). Escape: the overlay store (#13). */
export const TocSidebar = memo(function TocSidebar(p: TocSidebarProps) {
  const { open, tab } = p;
  return (
    <aside
      className={styles.sidebar}
      data-open={open}
      data-animate={p.animate}
      data-mode={p.mode ?? 'overlay'}
      aria-label="Contents"
      aria-hidden={!open}
      inert={!open}
    >
      <div className={styles.tabs} role="tablist" aria-label="Sidebar">
        {(['contents', 'bookmarks'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`toc-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`toc-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={styles.tab}
            onClick={() => p.onTabChange(t)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const other = t === 'contents' ? 'bookmarks' : 'contents';
                p.onTabChange(other);
                requestAnimationFrame(() => document.getElementById(`toc-tab-${other}`)?.focus());
              }
            }}
          >
            {t === 'contents' ? 'Contents' : 'Bookmarks'}
          </button>
        ))}
      </div>
      <div
        className={styles.body}
        role="tabpanel"
        id={`toc-panel-${tab}`}
        aria-labelledby={`toc-tab-${tab}`}
      >
        {!open ? null : tab === 'contents' ? <Contents {...p} /> : <Bookmarks {...p} />}
      </div>
    </aside>
  );
});

function reveal(toc: TocItem[], href: string | null, base: Set<string>): Set<string> {
  const anc = ancestorsOf(toc, href);
  return anc.every((k) => base.has(k)) ? base : new Set([...base, ...anc]);
}

const NO_KEYS: ReadonlySet<string> = new Set();

function Contents({ toc, spans, reading, readKeys = NO_KEYS, onNavigate, open }: TocSidebarProps) {
  const chapterKeys = useMemo(() => new Map(spans.map((sp) => [sp.key, sp.chapterKey])), [spans]);
  const currentHref = reading.currentHref;
  const [exp, setExp] = useState(() => ({
    toc,
    href: currentHref,
    set: reveal(toc, currentHref, defaultExpanded(toc)),
  }));
  const [active, setActive] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  // Reset expansion when the book changes; reveal the current chapter's ancestors (derived during render).
  let expanded = exp.set;
  if (exp.toc !== toc || exp.href !== currentHref) {
    expanded = reveal(toc, currentHref, exp.toc === toc ? exp.set : defaultExpanded(toc));
    setExp({ toc, href: currentHref, set: expanded });
  }
  const setExpanded = (fn: (s: Set<string>) => Set<string>) =>
    setExp((e) => ({ ...e, set: fn(e.set) }));

  const rows = useMemo(() => flattenToc(toc, expanded), [toc, expanded]);
  // t32u: while the entries of the reader's section cannot be told apart yet (fragment offsets still
  // being measured) no row is current: the section-level href would name the wrong chapter.
  const currentKey =
    reading.currentKey && rows.some((r) => r.key === reading.currentKey) ? reading.currentKey : null;
  const focusKey =
    active && rows.some((r) => r.key === active) ? active : (currentKey ?? rows[0]?.key ?? null);

  // Centre the current row whenever the sidebar opens or the chapter changes.
  useEffect(() => {
    if (!open || !currentKey) return;
    treeRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: 'center' });
  }, [open, currentKey]);

  if (!toc.length) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No table of contents</p>
        <p className={styles.emptyHint}>This book does not define chapters.</p>
      </div>
    );
  }

  const focusRow = (key: string) => {
    setActive(key);
    treeRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
  };
  const toggle = (key: string, on: boolean) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = rows.findIndex((r) => r.key === focusKey);
    const row = rows[i];
    if (!row) return;
    const isOpen = expanded.has(row.key);
    switch (e.key) {
      case 'ArrowDown':
        if (rows[i + 1]) focusRow(rows[i + 1].key);
        break;
      case 'ArrowUp':
        if (rows[i - 1]) focusRow(rows[i - 1].key);
        break;
      case 'Home':
        focusRow(rows[0].key);
        break;
      case 'End':
        focusRow(rows[rows.length - 1].key);
        break;
      case 'ArrowRight':
        if (row.hasChildren && !isOpen) toggle(row.key, true);
        else if (row.hasChildren && rows[i + 1]) focusRow(rows[i + 1].key);
        break;
      case 'ArrowLeft':
        if (row.hasChildren && isOpen) toggle(row.key, false);
        else if (row.parent) focusRow(row.parent);
        break;
      case 'Enter':
      case ' ':
        onNavigate(row.href);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={treeRef}
      className={styles.tree}
      role="tree"
      aria-label="Table of contents"
      onKeyDown={onKey}
    >
      {rows.map((r) => {
        const isOpen = expanded.has(r.key);
        const isCur = r.key === currentKey;
        // t29u: every visited chapter except the last-read one is muted; the % belongs to the last-read one only
        const ck = chapterKeys.get(r.key);
        const isRead = !isCur && !!ck && readKeys.has(ck);
        return (
          <div
            key={r.key}
            data-key={r.key}
            role="treeitem"
            aria-level={r.level}
            aria-expanded={r.hasChildren ? isOpen : undefined}
            aria-current={isCur ? 'true' : undefined}
            aria-selected={isCur}
            tabIndex={r.key === focusKey ? 0 : -1}
            className={styles.item}
            data-current={isCur}
            data-read={isRead}
            style={{ paddingInlineStart: `calc(var(--space-2) + ${(r.level - 1) * 16}px)` }}
            onClick={() => {
              setActive(r.key);
              onNavigate(r.href);
            }}
            onFocus={() => setActive(r.key)}
          >
            {r.hasChildren ? (
              <span
                className={styles.chevron}
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(r.key, !isOpen);
                }}
              >
                {isOpen ? (
                  <ChevronDown size={16} strokeWidth={1.5} />
                ) : (
                  <ChevronRight size={16} strokeWidth={1.5} />
                )}
              </span>
            ) : (
              <span className={styles.chevronGap} aria-hidden="true" />
            )}
            {isCur && <span className={styles.dot} aria-hidden="true" />}
            <span className={styles.label} title={r.label}>
              {r.label}
            </span>
            {isCur && reading.currentKey === r.key && reading.percent !== null && (
              <span className={styles.pct} title="Progress in this chapter">
                {reading.percent}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Bookmarks({ bookmarks, onBookmarkOpen, onBookmarkDelete }: TocSidebarProps) {
  if (!bookmarks.length) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No bookmarks yet</p>
        <p className={styles.emptyHint}>Press Ctrl+D to bookmark where you are.</p>
      </div>
    );
  }
  return (
    <ul className={styles.bmList} aria-label="Bookmarks">
      {bookmarks.map((b) => (
        <li key={b.id} className={styles.bmRow}>
          <button
            type="button"
            className={styles.bmMain}
            onClick={() => onBookmarkOpen(b.id)}
            onKeyDown={(e) => {
              if (e.key === 'Delete') {
                e.preventDefault();
                onBookmarkDelete(b.id);
              }
            }}
          >
            <span className={styles.bmHead}>
              <span className={styles.bmLabel}>{b.label}</span>
              <span className={styles.bmPct}>{pct(b.progress)}</span>
            </span>
            <span className={styles.bmExcerpt}>{b.excerpt}</span>
            <span className={styles.bmDate}>{bookmarkDate(b.createdAt)}</span>
          </button>
          <button
            type="button"
            className={styles.bmDelete}
            aria-label={`Delete bookmark: ${b.label}`}
            title="Delete"
            onClick={() => onBookmarkDelete(b.id)}
          >
            <Trash2 size={16} strokeWidth={1.5} />
          </button>
        </li>
      ))}
    </ul>
  );
}
