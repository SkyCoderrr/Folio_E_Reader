// @ts-expect-error -- pinned foliate JavaScript has no declarations (ADR-001)
import * as CFI from '../../vendor/foliate-js/epubcfi.js';
import type { Locator } from '@contract/types';
import { invoke } from '../ipc/commands';
import type { LocatorBridge } from './renderers/FlowRenderer';
import { buildSectionText, offsetOfBoundary, rangeAtOffset } from './renderers/flow/sectionText';

/** Uses the identical UTF-16 body-text definition as FlowRenderer. */
export function charOffsetFromRange(range: Range): number {
  return offsetOfBoundary(
    buildSectionText(range.startContainer.ownerDocument!),
    range.startContainer,
    range.startOffset,
  );
}
export function resolveCharOffset(doc: Document, offset: number): Range {
  return rangeAtOffset(doc, buildSectionText(doc), offset);
}
/**
 * EPUB bridge. `sectionChars` returns the measured body-text length per section (null until the
 * book is measured): the basis of Locator.progress (one owner, see flowAnchor.locatorOf).
 */
export function createLocatorBridge(
  sectionCount: number,
  sectionChars: () => readonly number[] | null = () => null,
): LocatorBridge {
  return {
    sectionChars,
    globalCharOffset(index, offset) {
      const chars = sectionChars();
      if (!chars || index < 0 || index >= chars.length) return null;
      return chars.slice(0, index).reduce((a, b) => a + b, 0) + Math.min(chars[index]!, Math.max(0, offset));
    },
    cfiFromRange(index, range) {
      try {
        return CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(range));
      } catch {
        return null;
      }
    },
    parseCfi(cfi) {
      try {
        const parts = CFI.parse(cfi);
        const sectionIndex = CFI.fake.toIndex(parts[0]);
        if (
          !Number.isInteger(sectionIndex) ||
          sectionIndex < 0 ||
          sectionIndex >= sectionCount ||
          parts.length !== 2
        )
          return null;
        return {
          sectionIndex,
          toRange(doc) {
            try {
              return CFI.toRange(doc, parts.slice(1));
            } catch {
              return null;
            }
          },
        };
      } catch {
        return null;
      }
    },
  };
}
export function parseLocator(value: unknown): Locator | undefined {
  if (!value || typeof value !== 'object') return;
  const p = value as Locator;
  const offset = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (
    !offset(p.sectionIndex) ||
    !offset(p.charOffset) ||
    !(p.globalCharOffset === null || offset(p.globalCharOffset)) ||
    !(p.cfi === null || (typeof p.cfi === 'string' && p.cfi.length <= 4096)) ||
    !Number.isFinite(p.progress) ||
    p.progress < 0 ||
    p.progress > 1 ||
    typeof p.snippet !== 'string' ||
    Array.from(p.snippet).length > 200
  )
    return;
  return {
    sectionIndex: p.sectionIndex,
    cfi: p.cfi,
    charOffset: p.charOffset,
    globalCharOffset: p.globalCharOffset,
    progress: p.progress,
    snippet: p.snippet,
  };
}
/** Content identity is stable across filenames and satisfies the KV key grammar. */
export async function positionKey(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return `pos:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export interface PositionStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: Locator): Promise<unknown>;
}
const ipcStore: PositionStore = {
  get: (bookId) => invoke('position_get', { bookId }),
  set: (bookId, locator) => invoke('position_save', { bookId, locator }),
};
/** One write in flight; newer pending positions replace older ones. Failures remain retryable. */
export class PositionPersistence {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Locator | undefined;
  private flight: Promise<void> | undefined;
  constructor(
    readonly key: string,
    private store = ipcStore,
    private onError: (e: unknown) => void = console.warn,
  ) {}
  async restore() {
    return parseLocator(await this.store.get(this.key));
  }
  schedule(locator: Locator) {
    this.pending = { ...locator };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(this.onError);
    }, 1000);
  }
  async flush(locator?: Locator): Promise<void> {
    if (locator) this.pending = { ...locator };
    clearTimeout(this.timer);
    if (this.flight) {
      await this.flight;
      return this.flush();
    }
    if (!this.pending) return;
    const next = this.pending;
    this.pending = undefined;
    this.flight = this.store
      .set(this.key, next)
      .then(() => undefined)
      .catch((e) => {
        this.pending ??= next;
        throw e;
      });
    try {
      await this.flight;
    } finally {
      this.flight = undefined;
    }
    if (this.pending) await this.flush();
  }
}
