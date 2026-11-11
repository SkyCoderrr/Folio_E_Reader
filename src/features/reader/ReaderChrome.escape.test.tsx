// @vitest-environment jsdom
/** Real Base UI popovers/menus (not mocked): closing them must hand focus to the reader and hide the chrome. */
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
        onMenusClosed={() => reader.el?.focus()}
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

for (const [name, label] of [['Layout popover', 'Layout'], ['More menu', 'More']] as const) {
  it(`${name}: closing with Escape returns focus to the reader and the chrome hides`, async () => {
    const { container, root, reader, visible } = await setup();
    const trigger = container.ownerDocument.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    await act(async () => trigger.click());
    await wait(50);
    await pressEscape();
    await wait(400);
    expect(document.activeElement).toBe(reader.el);
    expect(document.activeElement).not.toBe(trigger);
    expect(visible()).toBe('false');
    root.unmount();
  });
}
