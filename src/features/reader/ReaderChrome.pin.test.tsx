// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReaderChrome } from './ReaderChrome';
import { shiftStyle } from './ReaderView';

vi.mock('../../ui/TitleBar', () => ({ TitleBar: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));
vi.mock('../../ui/Popover', () => ({ Popover: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./ReaderView', async () => ({ shiftStyle: (await vi.importActual<typeof import('./ReaderView')>('./ReaderView')).shiftStyle }));

it('RS-01.3: pinning shows, un-pinning hides at once (no linger) and edge reveal still works', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const chrome = () => container.querySelector('[data-visible]') as HTMLElement;
  const render = (pinned: boolean) => root.render(<ReaderChrome pinned={pinned}><div>Book</div></ReaderChrome>);
  await act(async () => render(false));
  await act(async () => render(true));
  expect(chrome().dataset.visible).toBe('true');
  await act(async () => render(false));
  expect(chrome().dataset.visible).toBe('false');
  await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { clientY: 5 })));
  expect(chrome().dataset.visible).toBe('true');
  root.unmount();
});

it('RS-10.1 / NAV-02.1: panels shift the text column only at >= 1280 px', () => {
  expect(shiftStyle(1279, false, true)).toBeUndefined();
  expect(shiftStyle(1280, false, true)?.width).toBe('calc(100% - 0px - var(--panel-width))');
  expect(shiftStyle(1400, true, false)?.marginLeft).toBe('var(--sidebar-width)');
});
