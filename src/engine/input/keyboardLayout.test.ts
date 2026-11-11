import { expect, it } from 'vitest';
import { layoutKey, watchKeyboardLayout } from './keyboardLayout';

it('labels physical codes with the current layout and falls back when unavailable', async () => {
  expect(layoutKey('KeyA')).toBeUndefined();
  const stop = watchKeyboardLayout(() => undefined, {
    getLayoutMap: () => Promise.resolve(new Map([['KeyQ', 'a'], ['Digit1', '&']])),
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(layoutKey('Q')).toBe('A');
  expect(layoutKey('1')).toBe('&');
  stop();
  const stop2 = watchKeyboardLayout(() => undefined, { getLayoutMap: () => Promise.reject(new Error('x')) });
  await new Promise((r) => setTimeout(r, 0));
  expect(layoutKey('Q')).toBeUndefined();
  stop2();
});
