// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import defaults from '../../../contract/settings.defaults.json';
import { SmoothScroller, type FrameClock } from './smoothScroller';
import { pauseReading, subscribeReadingPause } from './pauseBus';
import { installKeyRouter } from './keyRouter';
import { forwardKey } from '../renderers/flow/eventForward';
import { ScrollAnimation } from './scrollAnimation';
import { ScrollPosition } from '../renderers/flow/scrollPosition';
import { effectiveKeymap } from './keymap';

function rig(hz = 60, options = {}, scale = 0, reducedMotion = false, regularFrames = false) {
  let time = 0,
    id = 0,
    top = 10000;
  const frames = new Map<number, (t: number) => void>();
  const deltas: number[] = [];
  const position = new ScrollPosition();
  const element = {
    get scrollTop() {
      return top;
    },
    set scrollTop(n: number) {
      top = Math.round(n * scale) / scale;
    },
    scrollHeight: 100800,
    clientHeight: 800,
  } as HTMLElement;
  const clock: FrameClock = {
    now: () => time,
    request: (cb) => {
      frames.set(++id, cb);
      return id;
    },
    cancel: (n) => {
      frames.delete(n);
    },
  };
  const target = {
    scrollBy: (n: number) => {
      if (scale) position.by(element, n, scale);
      else top = Math.max(0, Math.min(100000, top + n));
    },
    getScrollTop: () => top,
    getMaxScroll: () => 100000,
    getLineHeight: () => 35,
  };
  const scroller = new SmoothScroller(
    target,
    { ...defaults.scroll, ...options },
    clock,
    reducedMotion,
  );
  let nextFrame = 1000 / hz;
  const advance = (ms: number) => {
    const end = time + ms;
    while (time < end - 0.00001) {
      if (regularFrames && nextFrame > end + 1e-8) {
        time = end;
        break;
      }
      time = regularFrames ? nextFrame : Math.min(end, time + 1000 / hz);
      if (regularFrames) nextFrame += 1000 / hz;
      const callbacks = [...frames.values()];
      frames.clear();
      const before = top;
      callbacks.forEach((cb) => cb(time));
      if (callbacks.length) deltas.push(top - before);
    }
  };
  return { scroller, advance, top: () => top, frames, target, clock, deltas };
}
describe('held-arrow physics', () => {
  it('first frame after keydown moves at least 1 px (ease-in must not start at ~0)', () => {
    for (const hz of [60, 120]) {
      const r = rig(hz);
      r.scroller.press(1);
      r.advance(1000 / hz);
      expect(r.deltas[0]).toBeGreaterThanOrEqual(1);
    }
  });
  it('matches at 60, 120, 144 and 240 Hz', () => {
    const distances = [60, 120, 144, 240].map((hz) => {
      const r = rig(hz);
      r.scroller.press(1);
      r.advance(2000);
      return r.top() - 10000;
    });
    expect(Math.max(...distances) / Math.min(...distances)).toBeLessThan(1.02);
  });
  it('starts in one frame, ignores repeated press and reaches configured constant speed', () => {
    const r = rig(60, { acceleration: false });
    r.scroller.press(1);
    r.advance(16);
    expect(r.top()).toBeGreaterThan(10000);
    r.advance(200);
    r.scroller.press(1);
    const at = r.top();
    r.advance(1000);
    expect(r.top() - at).toBeCloseTo(720, 1);
  });
  it('a short tap totals three lines through a glide, without a keyup-time write', () => {
    const r = rig();
    r.scroller.press(1);
    r.advance(50);
    const before = r.top();
    r.scroller.release(1);
    expect(r.top()).toBe(before);
    r.advance(200);
    expect(r.top()).toBeCloseTo(10105);
    expect(r.frames.size).toBe(0);
  });
  it('decelerates and stops after release', () => {
    const r = rig();
    r.scroller.press(1);
    r.advance(500);
    r.scroller.release(1);
    const at = r.top();
    r.advance(200);
    expect(r.top()).toBeGreaterThan(at);
    expect(r.frames.size).toBe(0);
  });
  it('reverses direction and stops immediately when requested', () => {
    const r = rig();
    r.scroller.press(1);
    r.advance(500);
    const at = r.top();
    r.scroller.press(-1);
    r.advance(500);
    expect(r.top()).toBeLessThan(at);
    r.scroller.stop();
    expect(r.frames.size).toBe(0);
  });
  it('stops at a book edge', () => {
    const r = rig();
    r.scroller.press(-1);
    r.advance(20000);
    expect(r.top()).toBe(0);
    expect(r.frames.size).toBe(0);
  });
});

describe('scroll feel with a fake frame clock', () => {
  it.each([300, 600, 1000])('release curve preserves %i px/s and pending position', (velocity) => {
    const r = rig(240);
    const animation = new ScrollAnimation(r.target, r.clock);
    const pending = 2;
    animation.to(10042, false, 200, velocity, pending);
    expect(r.top()).toBe(10000);
    r.advance(0.001);
    // At release the virtual position is 10002. A tiny first interval measures
    // its right-hand derivative, including the shortened high-velocity curve.
    expect((r.top() - 10000 - pending) * 1000000).toBeCloseTo(velocity, 1);
    r.advance(200);
    expect(r.top()).toBeCloseTo(10042, 8);
    expect(r.frames.size).toBe(0);
  });

  it.each([60, 144, 240].flatMap((hz) => [30, 60, 110].map((keyup) => [hz, keyup])))(
    'tap deltas have one peak at %i Hz with keyup at %i ms',
    (hz, keyup) => {
      for (const direction of [1, -1] as const) {
        for (const scale of [0, 1]) {
          const r = rig(hz, {}, scale, false, true);
          r.scroller.press(direction);
          r.advance(keyup);
          const before = r.top();
          r.scroller.release(direction);
          expect(r.top()).toBe(before);
          r.advance(500);
          expect(r.top()).toBeCloseTo(10000 + direction * 105, 8);
          expect(r.frames.size).toBe(0);
          const deltas = r.deltas.map(Math.abs);
          const tolerance = scale ? 1 + 1e-8 : 1e-8;
          // A single peak must explain the entire sequence, including keyup.
          // Compare all pairs on each side so tolerated rounding cannot mask
          // a sustained second rise or an accumulating dip.
          expect(
            deltas.some((_, peak) =>
              deltas.every((delta, i) =>
                deltas.every(
                  (other, j) =>
                    j <= i ||
                    (i < peak && j > peak) ||
                    (j <= peak ? delta <= other + tolerance : delta + tolerance >= other),
                ),
              ),
            ),
          ).toBe(true);
        }
      }
    },
  );

  it.each([60, 144, 240])(
    'tap eases to zero at %i Hz in both directions, including device rounding',
    (hz) => {
      for (const direction of [1, -1] as const) {
        for (const scale of [0, 1, 1.5, 2]) {
          const r = rig(hz, {}, scale);
          r.scroller.press(direction);
          r.advance(60);
          const at = r.top();
          r.scroller.release(direction);
          expect(r.top()).toBe(at);
          r.advance(200);
          expect(Math.abs(r.top() - (10000 + direction * 105))).toBeLessThanOrEqual(
            scale ? 0.5 / scale + 1e-8 : 1e-8,
          );
          expect(r.frames.size).toBe(0);
          const deltas = r.deltas.map(Math.abs);
          const peak = deltas.indexOf(Math.max(...deltas));
          const quantum = scale ? 1 / scale : 0;
          for (let i = peak + 1; i < deltas.length; i++) {
            // Continuous curve is monotone; quantized samples stay within two device pixels (plateau jitter).
            expect(deltas[i]!).toBeLessThanOrEqual(deltas[i - 1]! + 2 * quantum + 1e-8);
          }
          for (let i = 1; i < deltas.length; i++) {
            if (deltas[i - 1]! < 1e-8) expect(deltas[i]!).toBeLessThanOrEqual(1 + 1e-8);
          }
          expect(deltas.at(-1)!).toBeLessThanOrEqual(1);
          const end = r.top();
          r.advance(1000);
          expect(r.top()).toBe(end);
        }
      }
    },
  );

  it.each([60, 144, 240])('hold delivers even device-pixel deltas at %i Hz', (hz) => {
    const r = rig(hz, { acceleration: false }, 1);
    r.scroller.press(1);
    r.advance(1000);
    r.deltas.length = 0;
    r.advance(1000);
    expect(r.deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 6);
    expect(Math.max(...r.deltas) - Math.min(...r.deltas)).toBeLessThanOrEqual(1);
    expect(Math.min(...r.deltas)).toBeGreaterThan(0);
    r.scroller.release(1);
    r.deltas.length = 0;
    r.advance(100);
    expect(r.deltas.at(-1)!).toBeLessThanOrEqual(1);
    expect(r.frames.size).toBe(0);
  });

  it.each([60, 144, 240])(
    'page reaches the exact overlap target within 250ms at %i Hz with ease-out',
    (hz) => {
      const r = rig(hz, {}, 1);
      const animation = new ScrollAnimation(r.target, r.clock);
      animation.to(10730);
      r.advance(200);
      expect(r.top()).toBe(10730);
      expect(r.frames.size).toBe(0);
      expect(r.deltas.at(-1)!).toBeLessThanOrEqual(1);
      for (let i = 1; i < r.deltas.length; i++) {
        expect(r.deltas[i]!).toBeLessThanOrEqual(r.deltas[i - 1]! + 1);
      }
    },
  );

  it('repeated pages retarget the previous destination from the current position', () => {
    const r = rig(240);
    const animation = new ScrollAnimation(r.target, r.clock);
    animation.to(10730);
    r.advance(50);
    const at = r.top();
    animation.to(animation.destination + 730);
    expect(r.top()).toBe(at);
    r.advance(1000 / 240);
    expect(r.top()).toBeGreaterThan(at);
    r.advance(200);
    expect(r.top()).toBeCloseTo(11460, 8);
  });

  it('reduced motion snaps pages and taps once, with no animation or repeat stacking', () => {
    const r = rig(240, {}, 1, true);
    const animation = new ScrollAnimation(r.target, r.clock);
    animation.to(10730, true);
    expect(r.top()).toBe(10730);
    r.scroller.press(1);
    r.scroller.press(1);
    expect(r.top()).toBe(10835);
    r.scroller.release(1);
    expect(r.frames.size).toBe(0);
  });

  it('reverses a glide without overshoot and cancels its old completion', () => {
    const r = rig(240);
    const animation = new ScrollAnimation(r.target, r.clock);
    animation.to(10730);
    r.advance(50);
    const at = r.top();
    animation.to(9500);
    r.advance(200);
    expect(r.top()).toBeCloseTo(9500, 8);
    expect(r.top()).toBeLessThan(at);
    r.advance(500);
    expect(r.top()).toBeCloseTo(9500, 8);
  });
});

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((f) => f());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
describe('scoped key router', () => {
  function setup(scopes: ('reader' | 'reader.autoscroll' | 'app')[] = ['reader', 'app']) {
    const handle = vi.fn<(action: string, phase: string, event: KeyboardEvent) => boolean>(
        () => true,
      ),
      stop = vi.fn();
    disposers.push(installKeyRouter(window, { scopes: () => scopes, handle, stop }));
    return { handle, stop };
  }
  const key = (code: string, extra = {}) =>
    new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra });
  it('uses the highest active scope', () => {
    const r = setup(['reader', 'reader.autoscroll']);
    window.dispatchEvent(key('Space'));
    expect(r.handle.mock.calls[0]?.[0]).toBe('autoscroll.pause');
  });
  it('routes D to layout.togglePages only in reader scope and suppresses repeats', () => {
    const scopes: ('reader' | 'app')[] = ['app'];
    const r = setup(scopes);
    window.dispatchEvent(key('KeyD'));
    expect(r.handle).not.toHaveBeenCalled();
    scopes.push('reader');
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(key('KeyD'));
    expect(r.handle).not.toHaveBeenCalled();
    window.dispatchEvent(key('KeyD'));
    window.dispatchEvent(key('KeyD', { repeat: true }));
    expect(r.handle).toHaveBeenCalledExactlyOnceWith(
      'layout.togglePages',
      'down',
      expect.any(KeyboardEvent),
    );
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    window.dispatchEvent(key('KeyD'));
    expect(r.handle.mock.calls.map(([action, phase]) => [action, phase])).toEqual([
      ['layout.togglePages', 'down'],
      ['layout.togglePages', 'up'],
      ['layout.togglePages', 'down'],
    ]);
  });
  it('lets panels shadow reader navigation and respects unbound overrides', () => {
    const handle = vi.fn(() => true);
    disposers.push(
      installKeyRouter(window, {
        scopes: () => ['panel', 'reader'],
        bindings: { 'page.next': [] },
        scopedBindings: { panel: { dismiss: ['Space'] } },
        handle,
      }),
    );
    window.dispatchEvent(key('Space'));
    expect(handle).toHaveBeenCalledWith('dismiss', 'down', expect.any(KeyboardEvent));
    handle.mockClear();
    window.dispatchEvent(key('PageDown'));
    expect(handle).not.toHaveBeenCalled();
  });
  it('stops held movement on document hiding', () => {
    const r = setup();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(r.stop).toHaveBeenCalledOnce();
  });
  it('guards IME and editable fields', () => {
    const r = setup();
    window.dispatchEvent(key('ArrowDown', { isComposing: true }));
    window.dispatchEvent(key('ArrowDown', { key: 'Process' }));
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(key('ArrowDown'));
    expect(r.handle).not.toHaveBeenCalled();
  });
  it('accepts forwarded clones and cancels original default scrolling', () => {
    const r = setup();
    const original = key('PageDown');
    forwardKey(original, document.body);
    expect(r.handle.mock.calls[0]?.[0]).toBe('page.next');
    expect(original.defaultPrevented).toBe(true);
  });
  it('routes modifiers and suppresses OS repeat', () => {
    const r = setup();
    window.dispatchEvent(key('Home', { ctrlKey: true }));
    window.dispatchEvent(key('Home', { ctrlKey: true, repeat: true }));
    expect(r.handle).toHaveBeenCalledTimes(1);
    expect(r.handle.mock.calls[0]?.[0]).toBe('book.start');
  });
  it('deduplicates original and forwarded downs, then accepts one forwarded keyup', () => {
    const r = setup();
    window.dispatchEvent(key('ArrowDown'));
    forwardKey(key('ArrowDown'), document.body);
    forwardKey(key('ArrowDown', { repeat: true }), document.body);
    const originalUp = new KeyboardEvent('keyup', { code: 'ArrowDown', cancelable: true });
    forwardKey(originalUp, document.body);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown' }));
    expect(r.handle.mock.calls.map(([action, phase]) => [action, phase])).toEqual([
      ['scroll.down', 'down'],
      ['scroll.down', 'up'],
    ]);
    expect(originalUp.defaultPrevented).toBe(true);
  });
  it('ignores repeats after a genuine blur until a fresh press', () => {
    const r = setup();
    window.dispatchEvent(key('ArrowDown'));
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(key('ArrowDown', { repeat: true }));
    expect(r.handle).toHaveBeenCalledTimes(1);
    window.dispatchEvent(key('ArrowDown'));
    expect(r.handle).toHaveBeenCalledTimes(2);
  });
  it('ignores retired section shortcuts, including old saved bindings', () => {
    const legacyBindings = {
      'chapter.next': ['BracketRight'],
      'chapter.prev': ['BracketLeft'],
    };
    const map = effectiveKeymap({ ...legacyBindings, 'page.next': ['PageDown'] });
    expect(map).not.toHaveProperty('chapter.next');
    expect(map).not.toHaveProperty('chapter.prev');
    const r = setup();
    for (const code of ['BracketRight', 'BracketLeft']) window.dispatchEvent(key(code));
    window.dispatchEvent(key('PageDown', { ctrlKey: true }));
    window.dispatchEvent(key('PageUp', { ctrlKey: true }));
    expect(r.handle).not.toHaveBeenCalled();
  });
  it('releases held arrows even when focus moves to an input', () => {
    const r = setup();
    window.dispatchEvent(key('ArrowDown'));
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown', bubbles: true }));
    expect(r.handle.mock.calls[1]?.[1]).toBe('up');
  });
  it('preserves iframe editing and legacy IME guards while forwarding held-key releases', () => {
    const r = setup();
    const input = document.createElement('input');
    document.body.append(input);
    const forward = (event: KeyboardEvent) => forwardKey(event, document.body);
    input.addEventListener('keydown', forward);
    input.addEventListener('keyup', forward);
    input.dispatchEvent(key('KeyT'));
    forwardKey(key('KeyT', { keyCode: 229 }), document.body);
    const cancelled = key('KeyT');
    cancelled.preventDefault();
    forwardKey(cancelled, document.body);
    expect(r.handle).not.toHaveBeenCalled();
    forwardKey(key('ArrowDown'), document.body);
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown', bubbles: true }));
    expect(r.handle.mock.calls.map(([action, phase]) => [action, phase])).toEqual([
      ['scroll.down', 'down'],
      ['scroll.down', 'up'],
    ]);
    input.removeEventListener('keydown', forward);
    input.removeEventListener('keyup', forward);
  });
  it('keeps scrolling when an iframe takes focus, stops on real blur', () => {
    const r = setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.dispatchEvent(new Event('blur'));
    expect(r.stop).not.toHaveBeenCalled();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    expect(r.stop).toHaveBeenCalledOnce();
  });
});

it('clears held keys and publishes the auto-scroll pause hook on boss interruption', () => {
  const handle = vi.fn(() => true),
    stop = vi.fn(),
    autoPause = vi.fn();
  const unsubscribe = subscribeReadingPause(autoPause);
  const uninstall = installKeyRouter(window, { scopes: () => ['reader'], handle, stop });
  const press = () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', cancelable: true }));
  press();
  pauseReading();
  press();
  expect(autoPause).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(handle.mock.calls).toHaveLength(2);
  unsubscribe();
  uninstall();
});
