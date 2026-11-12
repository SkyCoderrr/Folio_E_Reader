import type { LocatorRect } from './locatorRect';
import type { Locator } from '@contract/types';
import type { BookSource } from '../book/BookSource';
import type { CompiledStyle } from '../style/types';

/**
 * Common renderer interface (PRD §10.3).
 * scroll+1 → FlowRenderer · paged+1 → PaginatorRenderer · any flow + 2 → PaginatorRenderer as the
 * two-page filmstrip (ADR-005).
 * The PRD's `cb: (e: unknown) => void` is narrowed to typed payloads via RendererEventMap.
 */

export type RelocateReason = 'mount' | 'scroll' | 'goto' | 'style' | 'resize';

export interface RelocateEvent {
  /** First visible character (PRD §9.4). */
  locator: Locator;
  reason: RelocateReason;
}

/** The section under the reading line changed (TOC tracking, chapter keys). */
export interface SectionEvent {
  index: number;
}

/** A section document finished loading and has the reading style applied. */
export interface LoadEvent {
  index: number;
  doc: Document;
}

/**
 * Pages actually shown per view (narrow-window fallback, FR-LM-3 / LM-04 / LM-07). Emitted after
 * mount and whenever the effective value changes on resize. `requested` is the saved preference,
 * which the fallback never changes.
 */
export interface SpreadEvent {
  pagesPerView: 1 | 2;
  requested: 1 | 2;
}

export interface RendererEventMap {
  relocate: RelocateEvent;
  section: SectionEvent;
  load: LoadEvent;
  spread: SpreadEvent;
}

export type RendererEventName = keyof RendererEventMap;

export type GoToTarget = Locator | { href: string };

export interface Renderer {
  mount(el: HTMLElement, book: BookSource, css: CompiledStyle, at?: Locator): Promise<void>;
  /** Must preserve the current locator (drift ≤ 1 line). */
  setStyle(css: CompiledStyle): Promise<void>;
  goTo(target: GoToTarget): Promise<void>;
  getLocator(): Locator;
  /** Visible line rectangle in browser viewport coordinates; null for unmounted/off-screen text. */
  getLocatorRect(locator: Locator): LocatorRect | null;
  /** Flow: viewport minus overlap, 200 ms ease-out. Paginator: one page, ~180 ms slide (ADR-005). */
  page(dir: 1 | -1): void;
  /** ResizeObserver-driven; locator preserved. Safe to call manually. */
  resize(): void;
  on<K extends RendererEventName>(ev: K, cb: (e: RendererEventMap[K]) => void): () => void;
  destroy(): void;
}
