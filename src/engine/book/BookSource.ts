/**
 * BookSource: the format-neutral book interface every renderer consumes (PRD §10.3).
 *
 * Types only. `epubSource.ts` (foliate-js `makeBook`) and `txtSource.ts` implement it.
 * Shape follows PRD §10.3 and stays a superset of foliate-js's book object where possible.
 * Deviations, all recorded in docs/decisions/ADR-001-flow-renderer.md:
 *  - `resolveHref` may return `null` (unknown or external href; foliate-js returns null too).
 *  - `ResolvedHref.anchor` may return `null` (= section start; foliate-js can return 0/null).
 *  - `Section.resolveHref` is an optional extension (foliate-js has it) used to resolve links
 *    clicked inside a section document, whose raw hrefs are relative to that section.
 *  - `Section.linear` is a boolean here; foliate-js uses the OPF string ('no' = non-linear),
 *    so epubSource maps `linear: spineItem.linear !== 'no'`.
 */

/** One TOC entry (foliate-js `book.toc` shape). `href` is book-level: "path/file.xhtml#frag". */
export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[] | null;
}

export interface Section {
  /** Stable id within the book (foliate-js: the manifest href). */
  id: string;
  /** false = OPF `linear="no"`. FlowRenderer still renders it in spine order (ADR-001). */
  linear: boolean;
  /** Size used for progress and height estimation: bytes (EPUB) or UTF-16 chars (TXT). ≥ 0. */
  size: number;
  /**
   * URL the section iframe navigates to. MUST be same-origin with the app (a `blob:` URL), because
   * renderers inject styles and read layout through `iframe.contentDocument`. An `asset:` /
   * `http://asset.localhost` URL is cross-origin on Windows and would be unreadable (ADR-001 risk R3).
   * Every successful `load()` is balanced by exactly one `unload()`.
   */
  load(): Promise<string>;
  /** Parsed document without loading resources (search, TOC fragments, CFI on unmounted sections). */
  createDocument(): Promise<Document>;
  /** Releases what `load()` acquired (foliate-js revokes blob URLs by refcount). */
  unload(): void;
  /** Optional: resolve a raw href found inside this section to a book-level href. */
  resolveHref?(href: string): string;
}

export interface ResolvedHref {
  /** Index into `BookSource.sections`. */
  index: number;
  /** Target inside the loaded section document; absent or null = section start. */
  anchor?(doc: Document): Element | Range | null;
}

export interface BookMetadata {
  title: string;
  author?: string;
  language?: string;
}

export interface BookSource {
  format: 'epub' | 'txt';
  metadata: BookMetadata;
  toc: TocItem[];
  sections: Section[];
  /** Book-level href → section index (+ anchor). null when unknown or external. */
  resolveHref(href: string): ResolvedHref | null;
  /** "file.xhtml#frag" → ["file.xhtml", "frag"]. */
  splitTOCHref(href: string): [string, string?];
  destroy(): void;
}
