// @vitest-environment jsdom
import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));
vi.mock('../ipc/commands', () => ({ invoke: ipc.invoke }));
vi.mock('../ipc/events', () => ({ listen: vi.fn(async () => () => undefined) }));

import { TitleBar } from './TitleBar';

it('t41u: a press inside a portalled menu does not start a window drag; the bar itself still drags', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const portalHost = document.createElement('div');
  document.body.append(container, portalHost);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <TitleBar
        title="Book"
        showCaptionButtons={false}
        actions={createPortal(<div role="menuitem">Settings</div>, portalHost)}
      />,
    ),
  );
  ipc.invoke.mockClear();
  const down = (el: Element) =>
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
  down(portalHost.querySelector('[role="menuitem"]')!);
  expect(ipc.invoke).not.toHaveBeenCalledWith('window_start_drag', {});
  down(container.querySelector('header')!);
  expect(ipc.invoke).toHaveBeenCalledWith('window_start_drag', {});
  await act(async () => root.unmount());
});

it('#1: caption buttons observe resizes once, not on every render (Rust still gets every re-report)', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let observers = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor() {
        observers++;
      }
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  for (const title of ['A', 'B', 'C', 'D']) await act(async () => root.render(<TitleBar title={title} />));
  expect(observers).toBe(1);
  ipc.invoke.mockClear();
  await act(async () => void window.dispatchEvent(new Event('resize')));
  expect((ipc.invoke.mock.calls as unknown[][]).some(([command]) => command === 'window_set_caption_rects')).toBe(true);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
