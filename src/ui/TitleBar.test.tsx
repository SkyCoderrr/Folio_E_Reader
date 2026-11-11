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
