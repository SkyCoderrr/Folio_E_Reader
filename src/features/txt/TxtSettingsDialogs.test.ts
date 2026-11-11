import { afterEach, expect, it, vi } from 'vitest';
import { chapterDefaults, chapterPreviewDebouncer, prepareTxtPreferences } from './txtSettings';
import { invoke } from '../../ipc/commands';
import { useSettings } from '../../state/settingsStore';
vi.mock('../../ipc/commands', () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('debounces preview by 250 ms, resolves nulls to defaults, and cancels on close', async () => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockResolvedValue({ count: 1, first20: ['Chapter'] });
  const publish = vi.fn();
  const preview = chapterPreviewDebouncer('book', publish);
  preview.edit({ ...chapterDefaults, chapterRegex: 'old' });
  await vi.advanceTimersByTimeAsync(200);
  preview.edit(chapterDefaults);
  await vi.advanceTimersByTimeAsync(249);
  expect(invoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const defaults = useSettings.getState().settings.txt;
  expect(invoke).toHaveBeenCalledExactlyOnceWith('txt_preview_split', {
    bookId: 'book',
    chapterRegex: defaults.chapterRegex,
    headingMaxChars: defaults.headingMaxChars,
  });
  expect(publish).toHaveBeenLastCalledWith({ state: 'ok', count: 1, first20: ['Chapter'] });
  preview.edit(chapterDefaults);
  preview.cancel();
  await vi.advanceTimersByTimeAsync(250);
  expect(invoke).toHaveBeenCalledOnce();
});

it('discards responses from an older preview and reports current errors', async () => {
  vi.useFakeTimers();
  let finish!: (value: Awaited<ReturnType<typeof invoke>>) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as ReturnType<typeof invoke>,
  );
  const publish = vi.fn();
  const preview = chapterPreviewDebouncer('book', publish);
  preview.edit(chapterDefaults);
  await vi.advanceTimersByTimeAsync(250);
  preview.edit({ ...chapterDefaults, chapterRegex: '[' });
  finish({ count: 99, first20: [] });
  await Promise.resolve();
  expect(publish).toHaveBeenLastCalledWith({ state: 'loading' });
  vi.mocked(invoke).mockRejectedValueOnce({ message: 'Invalid regex' });
  await vi.advanceTimersByTimeAsync(250);
  expect(publish).toHaveBeenLastCalledWith({ state: 'error', error: 'Invalid regex' });
  preview.cancel();
});

it('persists an encoding or null chapter overrides before preparing again', async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce({ encoding: 'gb18030' })
    .mockResolvedValueOnce({ detectedEncoding: 'gb18030' });
  await prepareTxtPreferences('book', { encoding: 'gb18030' });
  expect(invoke).toHaveBeenNthCalledWith(1, 'txt_prefs_set', {
    bookId: 'book',
    patch: { encoding: 'gb18030' },
  });
  expect(invoke).toHaveBeenNthCalledWith(2, 'txt_prepare', { bookId: 'book' });
  vi.mocked(invoke).mockResolvedValueOnce({}).mockResolvedValueOnce({});
  await prepareTxtPreferences('book', chapterDefaults);
  expect(invoke).toHaveBeenNthCalledWith(3, 'txt_prefs_set', {
    bookId: 'book',
    patch: {
      chapterRegex: null,
      headingMaxChars: null,
      paragraphMode: null,
    },
  });
});

it('keeps the last valid chapter preview visible during edits and invalid regex errors', async () => {
  vi.useFakeTimers();
  const last = { count: 2, first20: ['Chapter I'] };
  vi.mocked(invoke).mockResolvedValueOnce(last).mockRejectedValueOnce({ message: 'Invalid regex' });
  const publish = vi.fn();
  const preview = chapterPreviewDebouncer('book', publish);
  preview.edit(chapterDefaults);
  await vi.advanceTimersByTimeAsync(250);
  preview.edit({ ...chapterDefaults, chapterRegex: '[' });
  expect(publish).toHaveBeenLastCalledWith({ state: 'loading', ...last });
  await vi.advanceTimersByTimeAsync(250);
  expect(publish).toHaveBeenLastCalledWith({ state: 'error', error: 'Invalid regex', ...last });
  preview.cancel();
});
