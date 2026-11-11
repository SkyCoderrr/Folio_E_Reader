// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  charOffsetFromRange,
  createLocatorBridge,
  parseLocator,
  PositionPersistence,
  resolveCharOffset,
} from './locator';
import type { Locator } from '@contract/types';
import { buildSectionText } from './renderers/flow/sectionText';
const position = (charOffset = 0): Locator => ({
  sectionIndex: 2,
  charOffset,
  cfi: null,
  globalCharOffset: null,
  progress: 0.25,
  snippet: 'hello',
});
afterEach(() => vi.useRealTimers());
describe('locator serialization and resolution (jsdom has no line layout)', () => {
  it('round trips 20 seeded random UTF-16 positions through vendor CFIs', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><title>excluded</title></head><body><p>Hello 世界😀 <em>nested text</em></p><p>Another paragraph with words.</p><script>excluded</script></body></html>',
      'text/html',
    );
    const bridge = createLocatorBridge(5);
    let seed = 7;
    for (let i = 0; i < 20; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const offset = seed % buildSectionText(doc).total;
      const range = resolveCharOffset(doc, offset);
      const cfi = bridge.cfiFromRange!(2, range)!;
      expect(cfi).toMatch(/^epubcfi\(/);
      const restored = bridge.parseCfi!(cfi)!;
      expect(restored.sectionIndex).toBe(2);
      expect(charOffsetFromRange(restored.toRange(doc)!)).toBe(offset);
      expect(parseLocator(JSON.parse(JSON.stringify({ ...position(offset), cfi })))).toEqual({
        ...position(offset),
        cfi,
      });
    }
  });
  it('rejects malformed positions and out-of-book CFIs', () => {
    expect(parseLocator({ ...position(), charOffset: -1 })).toBeUndefined();
    expect(parseLocator({ ...position(), progress: NaN })).toBeUndefined();
    expect(createLocatorBridge(1).parseCfi!('epubcfi(/6/8!/4/2:0)')).toBeNull();
  });
  it('debounces saves and restores the serialized position', async () => {
    vi.useFakeTimers();
    let saved: unknown = null;
    const set = vi.fn(async (_: string, p: Locator) => {
      saved = structuredClone(p);
    });
    const store = new PositionPersistence('pos:test', { get: async () => saved, set });
    store.schedule(position(1));
    store.schedule(position(2));
    await vi.advanceTimersByTimeAsync(999);
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(set).toHaveBeenCalledOnce();
    expect(await store.restore()).toEqual(position(2));
  });
  it('serializes concurrent writes and keeps only the newest pending position', async () => {
    let release!: () => void;
    const set = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const store = new PositionPersistence('pos:test', { get: async () => null, set });
    const first = store.flush(position(1));
    store.schedule(position(2));
    store.schedule(position(3));
    const last = store.flush();
    expect(set).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, last]);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls[1]?.[1]).toEqual(position(3));
  });
  it('flushes immediately for close and retries failed writes', async () => {
    const set = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    const store = new PositionPersistence('pos:test', { get: async () => null, set });
    await expect(store.flush(position(9))).rejects.toThrow('disk');
    await store.flush();
    expect(set.mock.calls[1]?.[1]).toEqual(position(9));
  });
});
