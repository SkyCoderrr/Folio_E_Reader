/**
 * Small renderer plumbing used by PageGridRenderer: typed event emitter, navigation pins, and
 * in-book link resolution. Same behaviour as the equivalent private members of FlowRenderer
 * (which is not refactored here while the scroll-feel work is in flight; ADR-002 follow-up).
 */
import type { BookSource } from '../../book/BookSource';
import type { CompiledStyle } from '../../style/types';
import type { AnchorStats } from '../flow/flowSlots';
import type { SlotLayout } from '../flow/slotLayout';
import { selectWindow, type SlotWindow } from '../flow/slotWindow';
import type { RendererEventMap, RendererEventName } from '../Renderer';
import type { GridGeometry } from './gridMath';

export interface PageGridDebugStats {
  mounted: number[];
  pxPerUnit: number;
  anchoring: AnchorStats;
  geometry: GridGeometry;
  /** The locator is the exact navigation target (its row is still at the top). */
  sticky: boolean;
}

/** Above this speed (viewports per second) the mount radius grows from 1 to 2 (as FlowRenderer). */
const FAST_VIEWPORTS_PER_SEC = 3;

/** Mount window for the current scroll position and velocity (same policy as FlowRenderer). */
export function mountWindow(layout: SlotLayout, st: number, vh: number, v: number, maxMounted: number): SlotWindow {
  return selectWindow({
    firstVisible: layout.indexAt(st),
    lastVisible: layout.indexAt(st + Math.max(0, vh - 1)),
    count: layout.count,
    radius: Math.abs(v) > FAST_VIEWPORTS_PER_SEC * vh ? 2 : 1,
    maxMounted,
    direction: v > 1 ? 1 : v < -1 ? -1 : 0,
  });
}

/** layout.pageGap: a `pageGapPx` on the CompiledStyle (proposed field) wins over the option. */
export function pageGapOf(css: CompiledStyle, fallback: number): number {
  const fromStyle = (css as CompiledStyle & { pageGapPx?: number }).pageGapPx;
  return typeof fromStyle === 'number' && Number.isFinite(fromStyle) ? fromStyle : fallback;
}

/** Scroll → `onScroll`; wheel/pointerdown cancel a running PgDn animation. Returns the unsubscribe. */
export function listenScroller(sc: HTMLElement, onScroll: () => void, cancel: () => void): () => void {
  const passive = { passive: true } as const;
  sc.addEventListener('scroll', onScroll, passive);
  sc.addEventListener('wheel', cancel, passive);
  sc.addEventListener('pointerdown', cancel, passive);
  return () => {
    sc.removeEventListener('scroll', onScroll);
    sc.removeEventListener('wheel', cancel);
    sc.removeEventListener('pointerdown', cancel);
  };
}

/** OS reduced-motion preference (the app has no own setting); false where matchMedia is missing. */
export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Listeners = { [K in RendererEventName]: Set<(e: RendererEventMap[K]) => void> };

export class RendererEmitter {
  #ls: Listeners = { relocate: new Set(), section: new Set(), load: new Set(), spread: new Set() };
  readonly #tag: string;

  constructor(tag: string) {
    this.#tag = tag;
  }

  on<K extends RendererEventName>(ev: K, cb: (e: RendererEventMap[K]) => void): () => void {
    const set = this.#ls[ev] as Set<(e: RendererEventMap[K]) => void>;
    set.add(cb);
    return () => set.delete(cb);
  }

  emit<K extends RendererEventName>(ev: K, payload: RendererEventMap[K]): void {
    for (const cb of this.#ls[ev] as Set<(e: RendererEventMap[K]) => void>) {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[${this.#tag}] ${ev} listener failed`, e);
      }
    }
  }

  clear(): void {
    for (const set of Object.values(this.#ls)) set.clear();
  }
}

/** Sections pinned by in-flight navigations (never unmounted); counted so overlaps do not unpin. */
export class PinSet {
  readonly pinned = new Set<number>();
  #count = new Map<number, number>();

  pin(index: number, delta: 1 | -1): void {
    const c = (this.#count.get(index) ?? 0) + delta;
    if (c > 0) {
      this.#count.set(index, c);
      this.pinned.add(index);
    } else {
      this.#count.delete(index);
      this.pinned.delete(index);
    }
  }
}

const EXTERNAL = /^(?!blob:)[a-z][a-z0-9+.-]*:/i;

/** A raw href clicked inside section `index`: external URL, or a book-level href to goTo. */
export function resolveLink(
  book: BookSource | null,
  index: number,
  raw: string,
): { external: string } | { href: string } | null {
  if (!raw) return null;
  if (EXTERNAL.test(raw)) return { external: raw };
  const section = book?.sections[index];
  return { href: raw.startsWith('#') ? `${section?.id ?? ''}${raw}` : (section?.resolveHref?.(raw) ?? raw) };
}
