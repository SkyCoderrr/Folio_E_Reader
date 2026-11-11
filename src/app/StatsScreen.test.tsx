// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { StatsScreen } from './StatsScreen';
import { invoke } from '../ipc/commands';
import { statsRange } from './statsModel';
vi.mock('../ipc/commands', () => ({ invoke: vi.fn() }));
vi.mock('../ui/TitleBar', () => ({
  TitleBar: ({ leading }: { leading: React.ReactNode }) => leading,
}));
const host = document.createElement('div');
const root = createRoot(host);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => {
  await act(async () => root.render(null));
  vi.resetAllMocks();
});
it('queries the last thirty days and opens the book from the mapped table', async () => {
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === 'library_list'
      ? []
      : ({
          days: [],
          books: [
            {
              bookId: 'alice',
              title: 'Alice',
              activeMs: 60000,
              chars: 200,
              progress: 0.4,
              lastReadAt: null,
              charsPerMin: null,
              finished: false,
            },
          ],
          totals: { activeMs: 60000, chars: 200 },
        } as never),
  );
  const onBack = vi.fn(),
    onOpenBook = vi.fn();
  await act(async () => root.render(createElement(StatsScreen, { onBack, onOpenBook })));
  expect(invoke).toHaveBeenCalledWith('stats_query', statsRange());
  expect(host.querySelectorAll('[data-slot="bar"]')).toHaveLength(30);
  const alice = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Alice')!;
  await act(async () => alice.click());
  expect(onOpenBook).toHaveBeenCalledWith('alice');
  await act(async () =>
    (host.querySelector('[aria-label="Back to Library"]') as HTMLElement).click(),
  );
  expect(onBack).toHaveBeenCalledOnce();
});
it('shows query failures and keeps Library available', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('unavailable'));
  const onBack = vi.fn();
  await act(async () => root.render(createElement(StatsScreen, { onBack, onOpenBook: vi.fn() })));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('unavailable');
  await act(async () => host.querySelector('button')!.click());
  expect(onBack).toHaveBeenCalledOnce();
});
