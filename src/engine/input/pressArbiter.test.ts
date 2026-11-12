// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { consumePress } from './pressArbiter';

afterEach(() => vi.useRealTimers());
const fire = (el: EventTarget, type: string) => {
  const e = new (type.startsWith('pointer') ? Event : MouseEvent)(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

it('#12: swallows the mousedown and click of a press held for seconds, with no timer', () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  const turn = vi.fn();
  host.addEventListener('click', turn);
  consumePress(host); // decided on this press's pointerdown
  expect(vi.getTimerCount()).toBe(0);
  expect(fire(host, 'mousedown').defaultPrevented).toBe(true);
  vi.advanceTimersByTime(5000); // a long press: the old 1 s timer let this click through
  fire(host, 'pointerup');
  expect(fire(host, 'click').defaultPrevented).toBe(true);
  expect(turn).not.toHaveBeenCalled();
  // The press is over: the next one is untouched.
  fire(host, 'pointerdown');
  expect(fire(host, 'mousedown').defaultPrevented).toBe(false);
  fire(host, 'click');
  expect(turn).toHaveBeenCalledOnce();
});

it('a press that never clicks (cancelled, or released elsewhere) does not leak into the next press', () => {
  const host = document.createElement('div');
  const turn = vi.fn();
  host.addEventListener('click', turn);
  consumePress(host);
  fire(host, 'pointercancel');
  fire(host, 'click');
  expect(turn).toHaveBeenCalledOnce();
  consumePress(host);
  fire(host, 'pointerdown'); // released elsewhere, then a new press starts
  fire(host, 'click');
  expect(turn).toHaveBeenCalledTimes(2);
});
