import { describe, expect, it } from 'vitest';
import type { FrameClock } from '../../input/scrollAnimation';
import { StripMotion } from './stripMotion';

function rig() {
  let time = 0;
  let id = 0;
  const frames = new Map<number, (t: number) => void>();
  const clock: FrameClock = {
    now: () => time,
    request: (cb) => (frames.set(++id, cb), id),
    cancel: (n) => void frames.delete(n),
  };
  const xs: number[] = [];
  let settled = 0;
  const m = new StripMotion((x) => xs.push(x), () => settled++, clock);
  const frame = (ms = 16) => {
    time += ms;
    const cbs = [...frames.values()];
    frames.clear();
    for (const cb of cbs) cb(time);
  };
  return { m, xs, frame, settled: () => settled, pending: () => frames.size };
}

describe('StripMotion (ADR-005)', () => {
  it('a step is a finite ease-out of STEP_MS that ends exactly on the target', () => {
    const r = rig();
    r.m.to(800, false, 800);
    r.frame();
    const first = r.m.x;
    expect(first).toBeGreaterThan(800 * 0.2); // visible movement in the first frame (fast start)
    let frames = 1;
    while (r.pending() > 0 && frames < 100) {
      r.frame();
      frames++;
    }
    expect(r.m.x).toBe(800);
    expect(frames * 16).toBeLessThanOrEqual(200);
    expect(r.settled()).toBe(1);
    // ease-out: per-frame steps never grow
    const steps = r.xs.slice(1).map((x, i) => x - r.xs[i]!);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThanOrEqual(steps[i - 1]! + 1e-9);
  });

  it('a new target while moving finishes the old step instantly (lag cap) and animates one page', () => {
    const r = rig();
    r.m.to(800, false, 800);
    r.frame();
    r.m.to(1600, false, 800); // second turn after one frame
    expect(r.m.x).toBe(800); // the first page is done at once
    r.m.to(2400, false, 800);
    expect(r.m.x).toBe(1600);
    while (r.pending() > 0) r.frame();
    expect(r.m.x).toBe(2400);
    expect(r.settled()).toBe(1);
  });

  it('reduced motion: every change is instant and settles synchronously', () => {
    const r = rig();
    r.m.to(800, true, 800);
    expect(r.m.x).toBe(800);
    expect(r.pending()).toBe(0);
    expect(r.settled()).toBe(1);
  });

  it('continuous retargets (held key) move every frame without stopping', () => {
    const r = rig();
    r.m.to(800, false, 800);
    let target = 800;
    let last = 0;
    for (let k = 0; k < 40; k++) {
      r.frame();
      target += 12; // 750 px/s of held travel
      r.m.to(target, false, 800);
      expect(r.m.x).toBeGreaterThan(last);
      last = r.m.x;
    }
    expect(r.settled()).toBe(0);
  });

  it('shift rebases position and target without disturbing the motion', () => {
    const r = rig();
    r.m.to(800, false, 800);
    r.frame();
    const x = r.m.x;
    r.m.shift(-800);
    expect(r.m.x).toBeCloseTo(x - 800);
    expect(r.m.target).toBe(0);
    while (r.pending() > 0) r.frame();
    expect(r.m.x).toBe(0);
  });
});
