// Foliate is pinned source, without TypeScript declarations (ADR-001).
// @ts-expect-error -- vendored JavaScript has no declaration file
import { EPUB } from '../../../vendor/foliate-js/epub.js';
import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  // @ts-expect-error -- vendored JavaScript has no declaration file
} from '../../../vendor/foliate-js/vendor/zip.js';
import type { BookSource, ResolvedHref, Section, TocItem } from './BookSource';

type LanguageMap = string | Record<string, string> | null;
type Contributor = string | { name: LanguageMap };
interface FoliateBook {
  rendition?: { layout?: string };
  metadata: {
    title?: LanguageMap;
    author?: Contributor | Contributor[];
    language?: string | string[];
  };
  sections: (Omit<Section, 'linear' | 'load'> & {
    linear?: string;
    load(): Promise<string | null>;
  })[];
  toc?: TocItem[];
  transformTarget: EventTarget;
  resolveHref(
    href: string,
  ): { index: number; anchor(doc: Document): Element | Range | number | null } | null;
  destroy(): void;
}
interface ZipEntry {
  filename: string;
  uncompressedSize: number;
  getData(writer: unknown): Promise<Blob | string>;
}
export interface EpubSourceOptions {
  /** Frozen app viewport, never the auto-height section iframe (ADR-001 R4).
   * Defaults to window.innerWidth/innerHeight at opening time. Reopen to refresh.
   */
  viewport?: { width: number; height: number };
}

const languageText = (value: LanguageMap | undefined): string =>
  typeof value === 'string' ? value : (Object.values(value ?? {})[0] ?? '');

/** Foliate Paginator.open's CSS normalization, without its column page-break rewrite. */
export function normalizeEpubCss(css: string, viewport: { width: number; height: number }): string {
  return css
    .replace(/(?<=[{\s;])-epub-/gi, '')
    .replace(/(\d*\.?\d+)vw\b/gi, (_, n: string) => `${(Number(n) * viewport.width) / 100}px`)
    .replace(/(\d*\.?\d+)vh\b/gi, (_, n: string) => `${(Number(n) * viewport.height) / 100}px`);
}

/** Reflowable EPUB adapter. URL input is normally a Tauri convertFileSrc asset URL. */
export async function epubSource(
  input: File | Blob | string | URL,
  options: EpubSourceOptions = {},
): Promise<BookSource> {
  let blob: Blob;
  if (typeof input === 'string' || input instanceof URL) {
    const response = await fetch(input);
    if (!response.ok)
      throw new Error(`EPUB fetch failed: ${response.status} ${response.statusText}`);
    blob = await response.blob();
  } else blob = input;
  if (!blob.size) throw new Error('EPUB is empty');
  // Same ZIP bridge as foliate makeBook, with per-reader options rather than global configure().
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  let book: FoliateBook | undefined;
  try {
    const entries: ZipEntry[] = await reader.getEntries();
    const files = new Map(entries.map((entry) => [entry.filename, entry]));
    book = await new EPUB({
      loadText: (name: string) => files.get(name)?.getData(new TextWriter()) ?? null,
      loadBlob: (name: string, type?: string) =>
        files.get(name)?.getData(new BlobWriter(type)) ?? null,
      getSize: (name: string) => files.get(name)?.uncompressedSize ?? 0,
    }).init();
    const parsed = book!;
    if (parsed.rendition?.layout === 'pre-paginated')
      throw Object.assign(new Error("Fixed-layout books aren't supported yet"), {
        code: 'BOOK_FIXED_LAYOUT',
      });
    const viewport = {
      ...(options.viewport ?? { width: window.innerWidth, height: window.innerHeight }),
    };
    if (![viewport.width, viewport.height].every((n) => Number.isFinite(n) && n > 0))
      throw new Error('EPUB viewport must have positive finite dimensions');
    const transform = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; data: string | Promise<string> }>)
        .detail;
      if (detail.type === 'text/css') {
        detail.data = Promise.resolve(detail.data).then((css) => normalizeEpubCss(css, viewport));
      } else if (['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(detail.type)) {
        detail.data = Promise.resolve(detail.data).then((markup) => {
          const doc = new DOMParser().parseFromString(
            markup,
            detail.type as DOMParserSupportedType,
          );
          const language =
            typeof parsed.metadata.language === 'string'
              ? parsed.metadata.language
              : parsed.metadata.language?.[0];
          if (
            language &&
            !doc.documentElement.hasAttribute('lang') &&
            !doc.documentElement.hasAttribute('xml:lang')
          )
            doc.documentElement.setAttribute('lang', language);
          for (const el of doc.querySelectorAll('style'))
            el.textContent = normalizeEpubCss(el.textContent ?? '', viewport);
          for (const el of doc.querySelectorAll('[style]'))
            el.setAttribute('style', normalizeEpubCss(el.getAttribute('style')!, viewport));
          return new XMLSerializer().serializeToString(doc);
        });
      }
    };
    parsed.transformTarget.addEventListener('data', transform);
    let destroyed = false;
    const assertOpen = () => {
      if (destroyed) throw new Error('EPUB source is destroyed');
    };
    const sections = parsed.sections.map((section): Section => {
      // Foliate caches by href but does not deduplicate concurrent initial loads.
      // Share one acquisition and maintain the public BookSource load/unload balance here.
      let pending: Promise<string> | undefined;
      let references = 0;
      return {
        id: section.id,
        linear: section.linear !== 'no',
        size: section.size,
        resolveHref: section.resolveHref?.bind(section),
        createDocument: () => {
          assertOpen();
          return section.createDocument();
        },
        async load() {
          assertOpen();
          if (!pending) {
            pending = section
              .load()
              .then((url) => {
                if (destroyed) {
                  // The request may have created URLs after destroy() cleared the cache.
                  parsed.destroy();
                  throw new Error('EPUB source is destroyed');
                }
                if (!url?.startsWith('blob:')) {
                  section.unload();
                  throw new Error(`EPUB section did not produce a blob URL: ${section.id}`);
                }
                return url;
              })
              .catch((error) => {
                pending = undefined;
                throw error;
              });
          }
          const url = await pending;
          references++;
          return url;
        },
        unload() {
          if (destroyed || references === 0) return;
          if (--references === 0) {
            section.unload();
            pending = undefined;
          }
        },
      };
    });
    return {
      format: 'epub',
      metadata: {
        title: languageText(parsed.metadata.title),
        author:
          [parsed.metadata.author ?? []]
            .flat()
            .map((author) => (typeof author === 'string' ? author : languageText(author.name)))
            .filter(Boolean)
            .join(', ') || undefined,
        language:
          typeof parsed.metadata.language === 'string'
            ? parsed.metadata.language
            : parsed.metadata.language?.[0],
      },
      toc: parsed.toc ?? [],
      sections,
      resolveHref(href): ResolvedHref | null {
        assertOpen();
        // External/non-spine links and malformed URI escapes are not navigable book targets.
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
        try {
          const hash = href.indexOf('#');
          const path = hash < 0 ? href : href.slice(0, hash);
          const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
          const resolved = parsed.resolveHref(path);
          if (!resolved || resolved.index < 0 || resolved.index >= sections.length) return null;
          return {
            index: resolved.index,
            anchor: (doc) =>
              fragment
                ? (doc.getElementById(fragment) ??
                  Array.from(doc.getElementsByName(fragment))[0] ??
                  null)
                : null,
          };
        } catch (error) {
          if (error instanceof URIError) return null;
          throw error;
        }
      },
      splitTOCHref(href) {
        const hash = href.indexOf('#');
        return hash < 0 ? [href] : [href.slice(0, hash), href.slice(hash + 1)];
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        parsed.transformTarget.removeEventListener('data', transform);
        parsed.destroy();
        void reader.close();
      },
    };
  } catch (error) {
    book?.destroy();
    await reader.close();
    throw error;
  }
}
