// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epubSource, normalizeEpubCss } from './epubSource';
// @ts-expect-error -- vendored JavaScript has no declaration file
import { EPUB } from '../../../vendor/foliate-js/epub.js';
import type { BookSource, TocItem } from './BookSource';

const books: BookSource[] = [];
const blobs = new Map<string, Blob>();
const fixture = async (name: string) =>
  new NodeFile([await readFile(resolve('tests/fixtures', name))], name, {
    type: 'application/epub+zip',
  }) as unknown as File;
const flatten = (items: TocItem[]): TocItem[] =>
  items.flatMap((item) => [item, ...flatten(item.subitems ?? [])]);
const open = async (input: File | Blob | string | URL) => {
  const book = await epubSource(input, { viewport: { width: 1200, height: 800 } });
  books.push(book);
  return book;
};

beforeEach(() => {
  // Node's Blob implements stream()/arrayBuffer(), needed by zip.js. Keep DOM parsing real.
  vi.stubGlobal('Blob', NodeBlob);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:http://localhost:3000/${crypto.randomUUID()}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    blobs.delete(url);
  });
});
afterEach(() => {
  for (const book of books.splice(0)) book.destroy();
  blobs.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  ['alice.epub', /Alice/i, /Carroll/i],
  ['pride-and-prejudice.epub', /Pride and Prejudice/i, /Austen/i],
] as const)('%s', (name, title, author) => {
  it('maps metadata, spine sections, documents and TOC', async () => {
    const book = await open(await fixture(name));
    expect(book.format).toBe('epub');
    expect(book.metadata.title).toMatch(title);
    expect(book.metadata.author).toMatch(author);
    expect(book.metadata.language).toBe('en');
    expect(book.sections.length).toBeGreaterThan(10);
    expect(new Set(book.sections.map((section) => section.id)).size).toBe(book.sections.length);
    for (const section of book.sections) {
      expect(typeof section.linear).toBe('boolean');
      expect(section.size).toBeGreaterThan(0);
      expect((await section.createDocument()).documentElement).toBeTruthy();
    }
    const toc = flatten(book.toc);
    expect(toc.length).toBeGreaterThan(10);
    for (const item of toc) {
      expect(item.label.trim()).not.toBe('');
      const target = book.resolveHref(item.href);
      expect(target).not.toBeNull();
      const [path, fragment] = book.splitTOCHref(item.href);
      expect(path).toBe(book.sections[target!.index].id);
      const doc = await book.sections[target!.index].createDocument();
      if (fragment) expect(target!.anchor?.(doc)).toBeTruthy();
      else expect(target!.anchor?.(doc)).toBeNull();
    }
  });

  it('returns same-origin blobs, shares concurrent loads and balances references', async () => {
    const book = await open(await fixture(name));
    const section = book.sections.find((section) => section.linear)!;
    const [one, two] = await Promise.all([section.load(), section.load()]);
    expect(one).toBe(two);
    expect(new URL(one).origin).toBe('http://localhost:3000');
    expect(blobs.get(one)?.type).toMatch(/html/);
    expect(await blobs.get(one)!.text()).toContain('<html');
    section.unload();
    expect(blobs.has(two)).toBe(true);
    section.unload();
    expect(blobs.has(two)).toBe(false);
    const fresh = await section.load();
    expect(fresh).not.toBe(one);
    book.destroy();
    expect(blobs.size).toBe(0);
    book.destroy();
    section.unload();
    await expect(section.load()).rejects.toThrow('destroyed');
  });

  it('resolves section-relative links and encoded fragments; rejects external/unknown targets', async () => {
    const book = await open(await fixture(name));
    const item = flatten(book.toc).find((item) => item.href.includes('#'))!;
    const target = book.resolveHref(item.href)!;
    const section = book.sections[target.index];
    const [, fragment] = book.splitTOCHref(item.href);
    expect(section.resolveHref?.(`#${fragment}`)).toBe(item.href);
    expect(
      book
        .resolveHref(`${section.id}#${encodeURIComponent(fragment!)}`)
        ?.anchor?.(await section.createDocument()),
    ).toBeTruthy();
    expect(book.resolveHref(section.id)?.anchor?.(await section.createDocument())).toBeNull();
    for (const href of [
      'https://example.com/',
      '//example.com/',
      'mailto:a@b.com',
      'missing.xhtml',
      '%ZZ.xhtml',
    ])
      expect(book.resolveHref(href)).toBeNull();
    expect(
      book.resolveHref(`${section.id}#missing`)?.anchor?.(await section.createDocument()),
    ).toBeNull();
    expect(book.splitTOCHref('a.xhtml')).toEqual(['a.xhtml']);
  });
});

it('accepts a Blob and a fetched asset URL', async () => {
  const file = await fixture('alice.epub');
  const blob = new NodeBlob([await file.arrayBuffer()]) as unknown as Blob;
  expect((await open(blob)).sections.length).toBeGreaterThan(10);
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
  vi.stubGlobal('fetch', fetch);
  await open(new URL('http://asset.localhost/C:/test/alice.epub'));
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
  await expect(open('http://asset.localhost/missing.epub')).rejects.toThrow('404');
});

it('rejects empty and invalid archives', async () => {
  await expect(open(new Blob([]))).rejects.toThrow('empty');
  await expect(open(new Blob(['not a zip']))).rejects.toThrow();
});

it('normalizes viewport units and EPUB prefixes with a fixed host viewport', () => {
  expect(
    normalizeEpubCss('p { -epub-hyphens: auto; width: 50vw; height:100vh; top:-2.5VH }', {
      width: 1200,
      height: 800,
    }),
  ).toBe('p { hyphens: auto; width: 600px; height:800px; top:-20px }');
});

// Tiny stored ZIP: exercises loader transforms without mocking Foliate or changing fixtures.
function storedZip(files: Record<string, string>): Blob {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const index = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return new NodeBlob([Buffer.concat([...locals, index, end])]) as unknown as Blob;
}

it('transforms external, embedded and inline CSS; preserves non-linear spine indexes and language', async () => {
  const book = await open(
    storedZip({
      'META-INF/container.xml':
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test</dc:identifier><dc:title>Test</dc:title><dc:language>zh-Hans</dc:language><dc:creator>One</dc:creator><dc:creator>Two</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="extra" href="extra.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/><itemref idref="notes" linear="no"/></spine></package>`,
      'chapter.xhtml':
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/><style>p {height: 50vh; -epub-hyphens: auto}</style></head><body><p id="中文" style="width:25vw">Chinese 中文</p></body></html>',
      'notes.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Notes</body></html>',
      'extra.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Extra</body></html>',
      'style.css': 'p { min-height: 10vh; width:50vw; -epub-hyphens:auto; }',
    }),
  );
  expect(book.metadata).toEqual({ title: 'Test', author: 'One, Two', language: 'zh-Hans' });
  expect(book.sections.map((section) => section.linear)).toEqual([true, false]);
  expect(book.resolveHref('notes.xhtml')?.index).toBe(1);
  expect(book.resolveHref('extra.xhtml')).toBeNull();
  expect(
    book
      .resolveHref('chapter.xhtml#%E4%B8%AD%E6%96%87')
      ?.anchor?.(await book.sections[0].createDocument()),
  ).toBeTruthy();
  const url = await book.sections[0].load();
  const markup = await blobs.get(url)!.text();
  expect(markup).toContain('lang="zh-Hans"');
  expect(markup).toContain('height: 400px');
  expect(markup).toContain('width:300px');
  expect(markup).not.toContain('-epub-');
  const css = (
    await Promise.all(
      [...blobs.values()].filter((blob) => blob.type === 'text/css').map((blob) => blob.text()),
    )
  ).join('');
  expect(css).toContain('min-height: 80px');
  expect(css).toContain('width:600px');
  book.sections[0].unload();
  expect(blobs.size).toBe(0);
});

it('cleans up blobs even when destroyed during an in-flight load', async () => {
  const book = await open(await fixture('alice.epub'));
  const pending = book.sections[0].load();
  book.destroy();
  await expect(pending).rejects.toThrow('destroyed');
  expect(blobs.size).toBe(0);
});

it('rejects foliate fixed-layout before constructing a reflowable source and releases resources', async () => {
  const destroy = vi.fn();
  vi.spyOn(EPUB.prototype, 'init').mockResolvedValueOnce({
    rendition: { layout: 'pre-paginated' },
    destroy,
  });
  await expect(open(await fixture('alice.epub'))).rejects.toMatchObject({
    code: 'BOOK_FIXED_LAYOUT',
  });
  expect(destroy).toHaveBeenCalledOnce();
  expect(blobs.size).toBe(0);
});
