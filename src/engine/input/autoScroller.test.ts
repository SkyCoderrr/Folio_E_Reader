import { describe, expect, it } from 'vitest';
import defaults from '../../../contract/settings.defaults.json';
import { AutoScroller, autoScrollSpeed } from './autoScroller';
import type { FrameClock } from './scrollAnimation';

function rig(hz = 60, paged = false, reduced = false) {
  let time = 0,
    id = 0,
    top = 0,
    pages = 0,
    end = false;
  const frames = new Map<number, (time: number) => void>();
  const writes: number[] = [];
  const clock: FrameClock = {
    now: () => time,
    request: (cb) => {
      frames.set(++id, cb);
      return id;
    },
    cancel: (id) => {
      frames.delete(id);
    },
  };
  const target = paged
    ? {
        kind: 'paged' as const,
        holdStart: () => false,
        holdMove: () => false,
        holdEnd: () => {},
      }
    : {
        kind: 'continuous' as const,
        scrollBy: (px: number) => {
          top += px;
          writes.push(px);
        },
        getScrollTop: () => top,
        getMaxScroll: () => 10000,
        getPixelSize: () => 1,
      };
  const auto = new AutoScroller(
    {
      ...target,
      getLineHeight: () => 20,
      getViewportHeight: () => 800,
      page: () => {
        pages++;
      },
      isAtEnd: () => end,
    },
    { ...defaults.autoscroll },
    reduced,
    undefined,
    clock,
  );
  return {
    auto,
    writes,
    frames,
    top: () => top,
    pages: () => pages,
    end: () => {
      end = true;
    },
    advance(ms: number) {
      const until = time + ms;
      while (time < until - 1e-8) {
        time = Math.min(until, time + 1000 / hz);
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((cb) => cb(time));
      }
    },
  };
}
describe('AutoScroller shared frame integration', () => {
  it.each([60, 120, 144])('delivers fractional distance at %i Hz', (hz) => {
    const r = rig(hz);
    r.auto.settings.speed = 10;
    r.auto.toggle();
    r.advance(1000);
    expect(r.top()).toBeCloseTo(10, 5);
    expect(r.writes[0]).toBeLessThan(1);
    r.auto.stop();
    expect(r.frames.size).toBe(0);
  });
  it('pauses and resumes without counting paused wall time; S stops a paused run', () => {
    const r = rig();
    r.auto.toggle();
    r.advance(1000);
    r.auto.togglePause();
    r.advance(90000);
    expect(r.top()).toBeCloseTo(40);
    expect(r.auto.state).toBe('paused');
    r.auto.togglePause();
    r.advance(1000);
    expect(r.top()).toBeCloseTo(80);
    r.auto.pause();
    r.auto.toggle();
    expect(r.auto.state).toBe('off');
    expect(r.frames.size).toBe(0);
  });
  it('applies percentage changes, clamped speed and step limits', () => {
    expect(autoScrollSpeed(40, 10, 1)).toBe(44);
    expect(autoScrollSpeed(40, 10, -1)).toBe(36);
    expect(autoScrollSpeed(399, 50, 1)).toBe(400);
    expect(autoScrollSpeed(5, 50, -1)).toBe(5);
    expect(autoScrollSpeed(40, 100, 1)).toBe(60);
    const r = rig();
    expect(r.auto.adjust(1)).toBe(44);
  });
  it('steps by lines under reduced motion, including a runtime preference change', () => {
    const r = rig(60, false, true);
    r.auto.toggle();
    r.advance(400);
    expect(r.top()).toBe(0);
    r.advance(200);
    expect(r.top()).toBe(20);
    expect(r.writes.every((n) => n % 20 === 0)).toBe(true);
    r.auto.setReducedMotion(false);
    r.advance(100);
    expect(r.top()).toBeGreaterThan(20);
  });
  it('turns paged views at the equivalent viewport/speed rate without pixel writes', () => {
    const r = rig(60, true);
    r.auto.settings.speed = 400;
    r.auto.toggle();
    r.advance(1990);
    expect(r.pages()).toBe(0);
    r.advance(30);
    expect(r.pages()).toBe(1);
    r.advance(2000);
    expect(r.pages()).toBe(2);
    expect(r.writes).toEqual([]);
  });
  it.each([false, true])('pauses at book end (paged=%s) and cancels future frames', (paged) => {
    const r = rig(60, paged);
    r.auto.toggle();
    r.end();
    r.advance(1000);
    expect(r.auto.state).toBe('paused');
    expect(r.frames.size).toBe(0);
    expect(r.writes).toEqual([]);
  });
});
