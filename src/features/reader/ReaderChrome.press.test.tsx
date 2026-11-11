// @vitest-environment jsdom
/** t24u: a press on the reading surface (also inside a book iframe) closes the Layout popover and panels. */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ReaderChrome } from './ReaderChrome';

vi.mock('../../ui/TitleBar', () => ({ TitleBar: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
afterEach(() => {
  document.body.innerHTML = '';
});

async function setup(onSurfacePress?: () => boolean) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ReaderChrome
        autoHideDelayMs={50}
        layout={{ pagesPerView: 1, onPagesPerViewChange: () => undefined }}
        onSurfacePress={onSurfacePress}
      >
        <div data-reading-surface="">
          <iframe title="book" id="book" />
        </div>
        <div id="elsewhere" />
      </ReaderChrome>,
    ),
  );
  const popup = () => document.querySelector('[role="dialog"]');
  const open = async () => {
    await act(async () => (document.querySelector('button[aria-label="Layout"]') as HTMLButtonElement).click());
    await wait(50);
    expect(popup()).not.toBeNull();
  };
  /** What SectionFrame sends when the press happened inside the book iframe. */
  const bookPress = () => {
    const e = new CustomEvent<{ consumed: boolean }>('reader-pointer-down', { bubbles: true, detail: { consumed: false } });
    act(() => void document.getElementById('book')!.dispatchEvent(e));
    return e.detail.consumed;
  };
  return { root, popup, open, bookPress };
}

it('a press inside the book closes the open Layout popover and is consumed', async () => {
  const { root, popup, open, bookPress } = await setup();
  await open();
  expect(bookPress()).toBe(true);
  await wait(400);
  expect(popup()).toBeNull();
  root.unmount();
});

it('a press inside the book with nothing open is left alone (page turns, links, selection keep working)', async () => {
  const press = vi.fn(() => false);
  const { root, bookPress } = await setup(press);
  expect(bookPress()).toBe(false);
  expect(press).toHaveBeenCalledTimes(1);
  root.unmount();
});

it('a press inside the book closes the reported panel (Appearance) and is consumed', async () => {
  const press = vi.fn(() => true);
  const { root, bookPress } = await setup(press);
  expect(bookPress()).toBe(true);
  root.unmount();
});

it('a press outside the reading surface is not a surface press', async () => {
  const press = vi.fn(() => true);
  const { root } = await setup(press);
  act(() => void document.getElementById('elsewhere')!.dispatchEvent(new Event('reader-pointer-down', { bubbles: true })));
  expect(press).not.toHaveBeenCalled();
  root.unmount();
});

it('a host-document press on the surface that closed a panel swallows its mousedown and click once', async () => {
  const { root } = await setup(() => true);
  const surface = document.querySelector('[data-reading-surface]') as HTMLElement;
  const seen: string[] = [];
  surface.addEventListener('click', () => seen.push('click'));
  act(() => void surface.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  act(() => void surface.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  act(() => void surface.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(seen).toEqual([]);
  act(() => void surface.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(seen).toEqual(['click']); // only that one click was swallowed
  root.unmount();
});
