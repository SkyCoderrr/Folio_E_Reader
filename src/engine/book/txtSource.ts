import { convertFileSrc } from '@tauri-apps/api/core';
import type { TxtManifest } from '@contract/types';
import type { BookSource, BookMetadata } from './BookSource';
import type { LocatorBridge } from '../renderers/flow/flowAnchor';

/** Cached HTML is fetched through Tauri, then exposed as same-origin, refcounted blobs. */
export function txtSource(manifest: TxtManifest, metadata: BookMetadata): BookSource {
  let destroyed = false;
  const releases: (() => void)[] = [];
  const sections = manifest.sections.map((entry) => {
    let refs = 0;
    let url: string | undefined;
    let pending: Promise<string> | undefined;
    const check = () => {
      if (destroyed) throw new Error('TXT source destroyed');
    };
    const markup = async () => {
      check();
      // convertFileSrc needs __TAURI_INTERNALS__; plain Node tests use the path as a mock URL.
      const asset =
        typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
          ? convertFileSrc(entry.path)
          : entry.path;
      const response = await fetch(asset);
      if (!response.ok) throw new Error(`TXT fetch failed: ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      check();
      doc.documentElement.lang = manifest.lang;
      return '<!doctype html>' + doc.documentElement.outerHTML;
    };
    const release = () => {
      if (url) URL.revokeObjectURL(url);
      url = undefined;
    };
    releases.push(release);
    return {
      id: `s${entry.index}.html`,
      linear: true,
      size: entry.chars,
      async load() {
        check();
        refs++;
        try {
          if (!url) {
            pending ??= markup()
              .then((html) => {
                check();
                url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
                return url;
              })
              .finally(() => {
                pending = undefined;
              });
          }
          return url ?? (await pending!);
        } catch (error) {
          refs--;
          throw error;
        }
      },
      async createDocument() {
        return new DOMParser().parseFromString(await markup(), 'text/html');
      },
      unload() {
        if (refs > 0 && --refs === 0) release();
      },
    };
  });
  const byId = new Map(sections.map((s, index) => [s.id, index]));
  return {
    format: 'txt',
    metadata: { ...metadata, language: manifest.lang },
    sections,
    toc: manifest.sections.map((s, index) => ({ label: s.title, href: sections[index].id })),
    resolveHref(href) {
      const [path, fragment] = href.split('#');
      const index = byId.get(path) ?? -1;
      return index < 0
        ? null
        : { index, anchor: (doc) => (fragment ? doc.getElementById(fragment) : null) };
    },
    splitTOCHref(href) {
      return href.split('#', 2) as [string, string?];
    },
    destroy() {
      destroyed = true;
      releases.forEach((release) => release());
    },
  };
}

/**
 * Manifest-based UTF-16 coordinates, preferred over stale section indexes after re-preparing.
 * TODO: Rust HTML needs source-offset metadata for exact decoded-text coordinates. Its
 * paragraph normalization removes whitespace and fallback sections add synthetic headings,
 * so DOM offsets currently approximate source offsets; snippets help re-anchor visible text.
 */
export function createTxtLocatorBridge(manifest: TxtManifest): LocatorBridge {
  const chars = manifest.sections.map((section) => section.chars);
  return {
    sectionChars: () => chars,
    globalCharOffset(index, offset) {
      const section = manifest.sections[index];
      return section ? section.startChar + Math.min(section.chars, Math.max(0, offset)) : null;
    },
    fromGlobalCharOffset(offset) {
      if (!Number.isFinite(offset) || !manifest.sections.length) return null;
      const global = Math.min(manifest.totalChars, Math.max(0, Math.floor(offset)));
      let index = manifest.sections.length - 1;
      while (index > 0 && manifest.sections[index].startChar > global) index--;
      const section = manifest.sections[index];
      return {
        sectionIndex: index,
        charOffset: Math.min(section.chars, global - section.startChar),
      };
    },
  };
}
