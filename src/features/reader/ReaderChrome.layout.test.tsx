// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReaderChrome } from './ReaderChrome';

vi.mock('../../ui/TitleBar', () => ({
  TitleBar: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}));
vi.mock('../../ui/Popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
it('offers Scroll/Paged and labels the effective narrow-window fallback without changing the preference', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const flow = vi.fn(),
    pages = vi.fn();
  const render = (effective: 1 | 2) =>
    root.render(
      <ReaderChrome
        layout={{
          pagesPerView: 2,
          effectivePagesPerView: effective,
          flow: 'scroll',
          onFlowChange: flow,
          onPagesPerViewChange: pages,
        }}
      >
        <div>Book</div>
      </ReaderChrome>,
    );
  try {
    await act(async () => render(1));
    const buttons = () => [...container.querySelectorAll('button')];
    expect(
      buttons()
        .find((b) => b.textContent === 'Two pages (window too narrow)')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    await act(async () =>
      buttons()
        .find((b) => b.textContent === 'Paged')!
        .click(),
    );
    expect(flow).toHaveBeenCalledWith('paged');
    expect(pages).not.toHaveBeenCalled();
    await act(async () =>
      buttons()
        .find((b) => b.textContent === 'One page')!
        .click(),
    );
    expect(pages).toHaveBeenCalledWith(1);
    await act(async () => render(2));
    expect(container.textContent).not.toContain('window too narrow');
    expect(
      buttons()
        .find((b) => b.textContent === 'Two pages')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
