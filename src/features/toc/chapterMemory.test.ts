import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterMemory, VISIT_DWELL_MS, type ChapterReadApi } from './chapterMemory';

/** In-memory stand-in for chapters_read_get / chapter_mark_read (persists across "launches"). */
function mockApi(initial: Record<string, string[]> = {}) {
  const db = new Map(Object.entries(initial).map(([k, v]) => [k, new Set(v)]));
  let inFlight = 0;
  let maxInFlight = 0;
  let fail = false;
  const api = {
    get: vi.fn(async (b: string) => [...(db.get(b) ?? [])]),
    mark: vi.fn(async (b: string, k: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      if (fail) throw new Error('nope');
      const set = db.get(b) ?? new Set<string>();
      set.add(k);
      db.set(b, set);
      return [...set];
    }),
  } satisfies ChapterReadApi;
  return { api, db, maxInFlight: () => maxInFlight, setFail: (v: boolean) => (fail = v) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const dwell = async (ms = VISIT_DWELL_MS) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('ChapterMemory (visited = read)', () => {
  it('a partial visit marks the chapter read after the dwell, with one API call', async () => {
    const { api } = mockApi();
    const m = new ChapterMemory('b1', api);
    await m.load();
    m.visit('s:2#');
    await dwell(VISIT_DWELL_MS - 10);
    expect(m.getSnapshot().has('s:2#')).toBe(false);
    await dwell(10);
    expect(m.getSnapshot().has('s:2#')).toBe(true);
    expect(api.mark).toHaveBeenCalledTimes(1);
    expect(api.mark).toHaveBeenCalledWith('b1', 's:2#');
  });

  it('skipping ahead (TOC jump / Ctrl+End) marks only the destination; skipped stay unread', async () => {
    const { api } = mockApi();
    const m = new ChapterMemory('b1', api);
    await m.load();
    m.visit('s:0#');
    await dwell();
    m.visit('s:9#');
    await dwell();
    expect([...m.getSnapshot()].sort()).toEqual(['s:0#', 's:9#']);
  });

  it('a fast glide through several chapters marks none of them until it settles', async () => {
    const { api } = mockApi();
    const m = new ChapterMemory('b1', api);
    await m.load();
    for (const k of ['s:1#', 's:2#', 's:3#', 's:4#']) {
      m.visit(k);
      await dwell(300);
    }
    expect(m.getSnapshot().size).toBe(0);
    expect(api.mark).not.toHaveBeenCalled();
    await dwell();
    expect([...m.getSnapshot()]).toEqual(['s:4#']);
  });

  it('jumping back keeps everything read; revisiting writes nothing', async () => {
    const { api } = mockApi();
    const m = new ChapterMemory('b1', api);
    await m.load();
    m.visit('s:5#');
    await dwell();
    m.visit('s:1#');
    await dwell();
    m.visit('s:5#');
    await dwell();
    expect([...m.getSnapshot()].sort()).toEqual(['s:1#', 's:5#']);
    expect(api.mark).toHaveBeenCalledTimes(2);
  });

  it('reopen restores the persisted read set and does not re-mark it', async () => {
    const mock = mockApi({ b1: ['t:0', 't:3'] });
    const m = new ChapterMemory('b1', mock.api);
    await m.load();
    expect([...m.getSnapshot()].sort()).toEqual(['t:0', 't:3']);
    m.visit('t:3');
    await dwell();
    expect(mock.api.mark).not.toHaveBeenCalled();
  });

  it('one write in flight at a time; a failed write retries on a later visit', async () => {
    const mock = mockApi();
    const errors: unknown[] = [];
    const m = new ChapterMemory('b1', mock.api, VISIT_DWELL_MS, (e) => errors.push(e));
    await m.load();
    mock.setFail(true);
    m.visit('t:1');
    await dwell();
    expect(errors).toHaveLength(1);
    expect(m.getSnapshot().has('t:1')).toBe(true); // still shown read locally
    mock.setFail(false);
    m.visit('t:2');
    await dwell();
    m.visit('t:1');
    await dwell();
    expect(mock.maxInFlight()).toBe(1);
    expect(mock.db.get('b1')).toEqual(new Set(['t:2', 't:1']));
  });

  it('null / dispose cancel a pending visit', async () => {
    const { api } = mockApi();
    const m = new ChapterMemory('b1', api);
    m.visit('t:1');
    m.visit(null);
    await dwell();
    m.visit('t:2');
    m.dispose();
    await dwell();
    expect(api.mark).not.toHaveBeenCalled();
  });
});
