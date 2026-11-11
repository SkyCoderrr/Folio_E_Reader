// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useFonts } from './useFonts';
import example from '../../contract/examples/fonts_list.json';
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../ipc/commands', () => ({ invoke: ipc.invoke }));
it('requests fonts once on idle and shares the result across consumers and remounts', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let idle!: () => void;
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    idle = callback;
  });
  ipc.invoke.mockResolvedValue(example.result);
  const container = document.createElement('div');
  const root = createRoot(container);
  function Consumer() {
    const { fonts } = useFonts();
    return createElement('span', null, fonts?.length ?? 'waiting');
  }
  await act(async () =>
    root.render(createElement('div', null, createElement(Consumer), createElement(Consumer))),
  );
  expect(ipc.invoke).not.toHaveBeenCalled();
  expect(container.textContent).toBe('waitingwaiting');
  await act(async () => idle());
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('fonts_list', {});
  expect(container.textContent).toBe('33');
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(Consumer)));
  expect(container.textContent).toBe('3');
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
