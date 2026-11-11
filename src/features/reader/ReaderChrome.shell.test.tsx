// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BUILTIN_PRESETS } from '../../engine/style/readingStyle';
import { ReaderChrome } from './ReaderChrome';
import { chromeColors, contrast } from './ReaderChrome.colors';

vi.mock('../../ui/TitleBar', () => ({ TitleBar: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));
vi.mock('../../ui/Popover', () => ({
  Popover: ({ children, onOpenChange, trigger }: { children: ReactNode; onOpenChange?: (o: boolean) => void; trigger: ReactNode }) => (
    <div>
      <button type="button" data-testid="open" onClick={() => onOpenChange?.(true)} />
      <button type="button" data-testid="close" onClick={() => onOpenChange?.(false)} />
      {trigger}
      {children}
    </div>
  ),
}));

it('UI-02 (2026-11-10): the preset reaches only the reading surface and footer, never other chrome', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const p = BUILTIN_PRESETS.find((x) => x.id === 'builtin.sepia')!.style.colors;
  await act(async () =>
    root.render(
      <ReaderChrome theme={{ background: p.background, text: p.text, accent: p.accent }} footer={<span>f</span>}>
        <div>Book</div>
      </ReaderChrome>,
    ),
  );
  const frame = container.firstElementChild as HTMLElement;
  expect(frame.style.getPropertyValue('--reader-bg')).toBe(p.background);
  for (const v of ['--chrome-bg', '--chrome-text-1', '--chrome-border', '--accent', '--accent-tint']) {
    expect(frame.style.getPropertyValue(v)).toBe('');
  }
  expect(container.querySelector('footer')!.style.getPropertyValue('--chrome-bg')).not.toBe('');
  root.unmount();
});

it('the footer stays readable on every preset while the shell tokens stay dark', () => {
  for (const p of BUILTIN_PRESETS) {
    const c = chromeColors(p.style.colors.background, p.style.colors.text)!;
    expect(contrast(c.text2, c.bg)).toBeGreaterThanOrEqual(4.5);
  }
  // Shell: text-1/text-2 on surface-0..2 (tokens.css, fixed dark theme) >= 4.5:1.
  for (const bg of ['#111214', '#18191c', '#222327']) {
    expect(contrast('#eceae6', bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#a3a09a', bg)).toBeGreaterThanOrEqual(4.5);
  }
});

it('closing the Layout menu with focus left in the bar hands focus back and the chrome hides again', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const back = vi.fn();
  await act(async () =>
    root.render(
      <ReaderChrome
        autoHideDelayMs={100}
        layout={{ pagesPerView: 1, onPagesPerViewChange: () => undefined }}
        onMenusClosed={back}
      >
        <div>Book</div>
      </ReaderChrome>,
    ),
  );
  const chrome = () => container.querySelector('[data-visible]') as HTMLElement;
  const trigger = container.querySelector('button[aria-label="Layout"]') as HTMLButtonElement;
  await act(async () => (container.querySelector('[data-testid="open"]') as HTMLElement).click());
  await act(async () => trigger.focus());
  expect(chrome().dataset.visible).toBe('true');
  await act(async () => (container.querySelector('[data-testid="close"]') as HTMLElement).click());
  await act(async () => void vi.advanceTimersByTime(1));
  expect(back).toHaveBeenCalled();
  await act(async () => trigger.blur());
  await act(async () => void vi.advanceTimersByTime(300));
  expect(chrome().dataset.visible).toBe('false');
  vi.useRealTimers();
  root.unmount();
});
