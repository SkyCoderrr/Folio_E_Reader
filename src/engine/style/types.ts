import type { ColorHex } from '@contract/types';

/**
 * Output of `compileStyle(ReadingStyle, ...)` as consumed by renderers (PRD FR-RS-3, §10.4).
 *
 * Split of responsibilities (ADR-001):
 *  - `css` is CONTENT styling only: fonts, colours, selection, spacing, indent, alignment, CJK rules,
 *    publisher-override level, forced single column. It is injected as the last
 *    `<style id="er-style">` of every section document.
 *    It must NOT set page geometry on `html`/`body` (width, max-width, horizontal padding,
 *    vertical padding, margins); the renderer owns geometry because it knows the viewport.
 *  - The numeric fields below are the geometry/metrics the renderer needs directly.
 */
export interface CompiledStyle {
  /** Content CSS injected into each section document (last style element in <head>). */
  css: string;
  /** Resolved font size in CSS px (`font.size`). */
  fontSizePx: number;
  /** Resolved line height in CSS px (`font.size × text.lineHeight`). Drives page overlap, tap lines, locator probe. */
  lineHeightPx: number;
  /** Maximum text-column width in CSS px (`layout.maxLineWidthEm × fontSizePx`); null = fill the viewport. */
  maxLineWidthPx: number | null;
  /** Minimum horizontal gap between the text column and the viewport edge (`layout.marginX`). */
  marginXPx: number;
  /** Space above the first and below the last section in scroll flow (`layout.marginY`). */
  marginYPx: number;
  /** Gap between pages in a two-page view (`layout.pageGap`). */
  pageGapPx: number;
  /** Reading background; renderers paint the host/scroller with it so no gap ever flashes. */
  background: ColorHex;
  /** Reading text colour; used for host-drawn decorations (chapter separator rule). */
  foreground: ColorHex;
}
