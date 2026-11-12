/**
 * Small renderer plumbing shared by FlowRenderer-style renderers (PaginatorRenderer): typed event
 * emitter, navigation pins, page gap, reduced motion, and in-book link resolution.
 */
import type { BookSource } from '../book/BookSource';
import type { RendererEventMap, RendererEventName } from './Renderer';

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
