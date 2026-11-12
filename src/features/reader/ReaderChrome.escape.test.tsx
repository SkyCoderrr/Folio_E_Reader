// @vitest-environment jsdom
/** Real Base UI popovers/menus (not mocked): where focus goes when they close (G0, #21). */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ReaderChrome } from './ReaderChrome';

vi.mock('../../ui/TitleBar', () => ({ TitleBar: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
afterEach(() => {
  document.body.innerHTML = '';
});

async function setup() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const reader = { el: null as HTMLElement | null };
  await act(async () =>
    root.render(
      <ReaderChrome
        autoHideDelayMs={50}
        layout={{ pagesPerView: 1, onPagesPerViewChange: () => undefined }}
        commands={[{ label: 'Item', onSelect: () => undefined }]}
        focusHome={() => reader.el}
      >
        <div tabIndex={-1} ref={(e) => void (reader.el = e)}>
          Book
        </div>
      </ReaderChrome>,
    ),
  );
  const visible = () => (container.querySelector('[data-visible]') as HTMLElement).dataset.visible;
  return { container, root, reader, visible };
}
const pressEscape = () =>
  act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  });

const mousePress = (el: Element) => {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    el.dispatchEvent(
      new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, detail: 1 }),
    );
};

for (const [name, label] of [['Layout popover', 'Layout'], ['More menu', 'More']] as const) {
  it(`${name}: opened with the mouse, closed with Escape: focus goes to the text and the chrome hides`, async () => {
    const { container, root, reader, visible } = await setup();
    const trigger = container.ownerDocument.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    await act(async () => mousePress(trigger));
    await wait(50);
    await pressEscape();
    await wait(400);
    expect(document.activeElement).toBe(reader.el);
    expect(visible()).toBe('false');
    root.unmount();
  });
  it(`G0 ${name}: opened and closed from the keyboard, focus stays on its button`, async () => {
    const { container, root } = await setup();
    const trigger = container.ownerDocument.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    trigger.focus();
    await act(async () => trigger.click()); // Enter/Space on a button: a click with detail 0
    await wait(50);
    await pressEscape();
    await wait(400);
    expect(document.activeElement).toBe(trigger);
    root.unmount();
  });
}
