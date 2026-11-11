// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReaderChrome } from './ReaderChrome';

vi.mock('../../ui/TitleBar', () => ({ TitleBar: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));

async function mount(readout: string | null) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (r: string | null) =>
    act(async () =>
      root.render(
        <ReaderChrome theme={{ background: '#fff', text: '#222', accent: undefined }} footer={<span>f</span>} readout={r}>
          <div>Book</div>
        </ReaderChrome>,
      ),
    );
  await render(readout);
  return { container, render, root };
}

it('t31u: off renders nothing; a readout renders as plain text and updates live', async () => {
  const { container, render, root } = await mount(null);
  expect(container.querySelector('[data-testid="footer-readout"]')).toBeNull();
  await render('6/24 · 37%');
  const el = container.querySelector<HTMLElement>('[data-testid="footer-readout"]')!;
  expect(el.textContent).toBe('6/24 · 37%');
  expect(el.children.length).toBe(0);
  expect(el.style.background).toBe('');
  await render('7/24 · 41%');
  expect(container.querySelector('[data-testid="footer-readout"]')!.textContent).toBe('7/24 · 41%');
  await render(null);
  expect(container.querySelector('[data-testid="footer-readout"]')).toBeNull();
  root.unmount();
});

it('t41u: the readout is anchored bottom-right (not centred), text-only and click-through', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/features/reader/ReaderChrome.module.css', 'utf8');
  const rule = /\n\.readout \{([^}]*)\}/.exec(css)![1]!;
  expect(rule).toMatch(/right:\s*var\(--space-4\)/);
  expect(rule).toMatch(/text-align:\s*right/);
  expect(rule).not.toMatch(/left:/);
  expect(rule).not.toMatch(/text-align:\s*center/);
  expect(rule).toMatch(/pointer-events:\s*none/);
  expect(rule).toMatch(/text-shadow:/);
  expect(rule).not.toMatch(/background/);
});
