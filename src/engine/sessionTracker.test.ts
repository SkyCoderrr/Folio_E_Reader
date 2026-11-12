import { describe, expect, it, vi } from 'vitest';
import type { ReadingSessionInput, Locator } from '@contract/types';
import { SessionTracker, readingEstimates } from './sessionTracker';
const loc = (n: number): Locator => ({
  sectionIndex: 0,
  charOffset: n,
  globalCharOffset: n,
  cfi: null,
  progress: n / 10000,
  snippet: '',
});
function setup() {
  let time = 0;
  const save = vi.fn<(session: ReadingSessionInput) => Promise<void>>(async () => undefined);
  const tracker = new SessionTracker('book', 30000, save, () => time);
  return {
    tracker,
    save,
    advance: (ms: number) => {
      time += ms;
      tracker.tick();
    },
  };
}
describe('SessionTracker', () => {
  it('splits at the exact idle cutoff and resumes on input', async () => {
    const { tracker: t, save, advance } = setup();
    t.relocate(loc(0), 1000);
    advance(60000);
    await t.flushPending();
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      startedAt: 0,
      endedAt: 30000,
      activeMs: 30000,
    });
    t.activity();
    advance(12000);
    await t.flush();
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      startedAt: 60000,
      endedAt: 72000,
      activeMs: 12000,
    });
  });
  it('counts running auto-scroll beyond idle, but excludes hidden time', async () => {
    const { tracker: t, save, advance } = setup();
    t.autoScroll(true);
    advance(200000);
    t.visibility(false);
    advance(100000);
    await t.flush();
    expect(save.mock.calls[0]?.[0]).toMatchObject({ activeMs: 200000, endedAt: 200000 });
    t.visibility(true);
    advance(10000);
    await t.flush();
    expect(save.mock.calls[1]?.[0]).toMatchObject({ activeMs: 10000, startedAt: 300000 });
  });
  it('discards short sessions, disabled time, and duplicate flushes', async () => {
    const { tracker: t, save, advance } = setup();
    advance(9999);
    await t.flush();
    expect(save).not.toHaveBeenCalled();
    t.configure(false, 30000);
    advance(60000);
    await t.flush();
    expect(save).not.toHaveBeenCalled();
    t.configure(true, 30000);
    t.activity();
    advance(10000);
    await Promise.all([t.flush(), t.flush()]);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('repeated visible checks do not extend the idle deadline', async () => {
    const { tracker: t, save, advance } = setup();
    for (let i = 0; i < 60; i++) {
      t.visibility(true);
      advance(1000);
    }
    await t.flushPending();
    expect(save.mock.calls[0]?.[0]).toMatchObject({ activeMs: 30000 });
  });
  it('excludes jumps and backwards motion, unlocks estimates at five active minutes', () => {
    const { tracker: t, advance } = setup();
    t.relocate(loc(0), 100);
    t.autoScroll(true);
    advance(299000);
    t.relocate(loc(50), 100);
    expect(t.speed).toBeNull();
    advance(1000);
    t.relocate(loc(100), 100);
    expect(t.speed).toBe(20);
    t.relocate(loc(5000), 100);
    t.relocate(loc(5050), 100, true);
    t.relocate(loc(10), 100);
    expect(t.speed).toBe(20);
    expect(readingEstimates(t.speed, 40, 200, true)).toMatchObject({
      speedLabel: '20 chars/min',
      timeLeftChapter: '2 min left in chapter',
    });
    expect(readingEstimates(null, 40, 200, false)).toEqual({});
  });
  it('keeps only thirty active minutes in the speed window', () => {
    const { tracker: t, advance } = setup();
    t.relocate(loc(0), 1000);
    t.autoScroll(true);
    advance(300000);
    t.relocate(loc(100), 1000);
    expect(t.speed).toBe(20);
    advance(1800000);
    expect(t.speed).toBeNull();
  });
  it('retries failed saves without dropping the interval', async () => {
    const { tracker: t, save, advance } = setup();
    save.mockRejectedValueOnce(new Error('offline'));
    advance(10000);
    await expect(t.flush()).rejects.toThrow('offline');
    await t.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

it('seeds persisted per-book speed and combines it with new active data', () => {
  const t = new SessionTracker(
    'book',
    30000,
    async () => undefined,
    () => 0,
  );
  t.seed(600000, 2000, 200);
  expect(t.speed).toBe(200);
  const fresh = new SessionTracker(
    'other',
    30000,
    async () => undefined,
    () => 0,
  );
  fresh.seed(299000, 1000, null);
  expect(fresh.speed).toBeNull();
});

it('reports one error per stats-save failure streak and retries retained data', async () => {
  let now = 0;
  const failure = { code: 'DB_ERROR', message: 'private sqlite detail' };
  const save = vi.fn(async () => { throw failure; });
  const report = vi.fn();
  const tracker = new SessionTracker('book', 30000, save, () => now, report);
  now = 12000;
  await expect(tracker.flush()).rejects.toEqual(failure);
  for (let i = 0; i < 10; i++) await expect(tracker.flushPending()).rejects.toEqual(failure);
  expect(report).toHaveBeenCalledOnce();
  save.mockImplementationOnce(async () => undefined as never);
  await tracker.flushPending();
  now += 12000;
  await expect(tracker.flush()).rejects.toEqual(failure);
  expect(report).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
});
