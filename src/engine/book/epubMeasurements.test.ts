// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { measureEpubSections } from './epubMeasurements';
import type { BookSource, Section } from './BookSource';
const cached = { fileHash: 'a'.repeat(64), sectionChars: [7, null], tocFragmentOffsets: { 'one#x': 2 } };
const doc = () => new DOMParser().parseFromString('<body><p>😀abc</p><p id="x">end</p></body>', 'text/html');
function source(read = vi.fn(async () => doc())): BookSource {
  return { format: 'epub', metadata: { title: 'Test' }, toc: [{ label: 'End', href: 'two#x' }],
    sections: [{ createDocument: vi.fn(async () => doc()) }, { createDocument: read }] as unknown as Section[],
    resolveHref: () => ({ index: 1, anchor: (d) => d.getElementById('x') }),
    splitTOCHref: () => ['two', 'x'], destroy() {} };
}
it('reuses cached sections and measures only missing sections and their fragments', async () => {
  const book = source();
  const result = await measureEpubSections(book, cached, vi.fn(), () => false);
  expect(book.sections[0]!.createDocument).not.toHaveBeenCalled();
  expect(book.sections[1]!.createDocument).toHaveBeenCalledOnce();
  expect(result?.sectionChars).toEqual([7, 8]);
  expect(result?.tocFragmentOffsets).toEqual({ 'one#x': 2, 'two#x': 5 });
  await measureEpubSections(book, result!, vi.fn(), () => false);
  expect(book.sections[1]!.createDocument).toHaveBeenCalledOnce();
});
it('retains successful counts across a failed section and retries only the failure', async () => {
  const read = vi.fn(async () => { throw new Error('bad section'); });
  const book = source(read);
  const failed = vi.fn();
  const partial = await measureEpubSections(book, cached, failed, () => false);
  expect(partial?.sectionChars).toEqual([7, null]);
  expect(partial?.tocFragmentOffsets).toEqual(cached.tocFragmentOffsets);
  expect(failed).toHaveBeenCalledOnce();
  expect(book.sections[0]!.createDocument).not.toHaveBeenCalled();
});
it('does not publish after disposal during measurement', async () => {
  let cancelled = false;
  const book = source(vi.fn(async () => { cancelled = true; return doc(); }));
  expect(await measureEpubSections(book, cached, vi.fn(), () => cancelled)).toBeNull();
});

it('yields before reading and between batches so the mounted reader can paint and handle input', async () => {
  vi.useFakeTimers();
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 9));
  const yieldTimer = vi.spyOn(globalThis, 'setTimeout');
  try {
    const book = source();
    const result = measureEpubSections(book, { ...cached, sectionChars: [null, null] }, vi.fn(), () => false);
    expect(book.sections[0]!.createDocument).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect((await result)?.sectionChars).toEqual([8, 8]);
    // The simulated work exceeds the batch budget: both sections need their own task.
    expect(yieldTimer).toHaveBeenCalledTimes(2);
  } finally {
    yieldTimer.mockRestore();
    clock.mockRestore();
    vi.useRealTimers();
  }
});
