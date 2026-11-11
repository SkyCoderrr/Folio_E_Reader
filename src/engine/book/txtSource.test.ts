// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Locator, TxtManifest } from '@contract/types';
import { txtSource, createTxtLocatorBridge } from './txtSource';
import { locatorAttempts, locatorOf } from '../renderers/flow/flowAnchor';
import { buildSectionText } from '../renderers/flow/sectionText';

const manifest: TxtManifest = {
  bookId: 'fixture',
  encoding: 'utf-8',
  detectedEncoding: 'utf-8',
  lang: 'zh-Hans',
  totalChars: 20,
  sections: [
    { index: 0, title: '第一章', path: 'C:/cache/s0001.html', startChar: 0, chars: 10 },
    { index: 1, title: '第二章', path: 'C:/cache/s0002.html', startChar: 10, chars: 10 },
  ],
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['zh-Hans', 'zh-Hant', 'en'])(
  'maps manifest headings, paths and %s language',
  async (lang) => {
    const fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '<html><body><p>中文😀text</p></body></html>',
    }));
    vi.stubGlobal('fetch', fetch);
    const book = txtSource({ ...manifest, lang }, { title: 'Book' });
    expect(book.metadata).toEqual({ title: 'Book', language: lang });
    expect(book.sections.map((s) => s.size)).toEqual([10, 10]);
    expect(book.toc.map((t) => t.label)).toEqual(['第一章', '第二章']);
    expect(book.resolveHref(book.toc[1].href)?.index).toBe(1);
    expect(book.resolveHref('https://example.com')).toBeNull();
    const doc = await book.sections[0].createDocument();
    expect(doc.documentElement.lang).toBe(lang);
    expect(doc.body.textContent).toBe('中文😀text');
    expect(fetch).toHaveBeenCalledWith(manifest.sections[0].path);
    book.destroy();
    await expect(book.sections[0].load()).rejects.toThrow('destroyed');
  },
);

it('fetches asset protocol URLs in Tauri and balances concurrent blob loads', async () => {
  const convert = vi.fn((path: string) => `asset:${path}`);
  Object.assign(window, { __TAURI_INTERNALS__: { convertFileSrc: convert } });
  const fetch = vi.fn(async () => ({ ok: true, text: async () => '<body><p>Text</p>' }));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:section');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  try {
    const book = txtSource(manifest, { title: 'Book' });
    const section = book.sections[0];
    expect(await Promise.all([section.load(), section.load()])).toEqual([
      'blob:section',
      'blob:section',
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`asset:${manifest.sections[0].path}`);
    section.unload();
    expect(revoke).not.toHaveBeenCalled();
    section.unload();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:section');
    book.destroy();
  } finally {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  }
});

it('round trips a TXT locator using UTF-16 and prioritizes its global offset after re-splitting', () => {
  const doc = new DOMParser().parseFromString('<body><p>中😀文abcdef</p>', 'text/html');
  const range = doc.createRange();
  range.setStart(doc.querySelector('p')!.firstChild!, 3);
  const bridge = createTxtLocatorBridge(manifest);
  const locator = locatorOf(
    { frameAt: () => ({ text: () => buildSectionText(doc) }) } as unknown as Parameters<
      typeof locatorOf
    >[0],
    { index: 1, range, viewportY: 0, fraction: 0 },
    [10, 10],
    bridge,
  );
  expect(locator).toMatchObject({ charOffset: 3, globalCharOffset: 13, cfi: null });
  expect(bridge.fromGlobalCharOffset!(locator.globalCharOffset!)).toEqual({
    sectionIndex: 1,
    charOffset: 3,
  });
  const changed = createTxtLocatorBridge({
    ...manifest,
    sections: [{ ...manifest.sections[0], chars: 20 }],
  });
  const first = locatorAttempts(locator, [20], changed)[0]();
  expect(first?.[0]).toBe(0);
  expect(changed.fromGlobalCharOffset!(13)).toEqual({ sectionIndex: 0, charOffset: 13 });
  expect(changed.fromGlobalCharOffset!(999)).toEqual({ sectionIndex: 0, charOffset: 20 });
  expect(
    locatorAttempts({ ...locator, globalCharOffset: null } as Locator, [10, 10])[0](),
  ).toBeNull();
});

it('reports fetch failures and rejects a pending load after destruction', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404 })),
  );
  const book = txtSource(manifest, { title: 'Book' });
  await expect(book.sections[0].load()).rejects.toThrow('404');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, text: async () => '<body>Text' })),
  );
  const pending = book.sections[0].load();
  book.destroy();
  await expect(pending).rejects.toThrow('destroyed');
});
