/**
 * Renderer-owned structural CSS for section documents in two-page scroll (ADR-002, candidate A).
 * Starts from the flow base CSS (single column on every descendant, no html/body margins,
 * horizontal writing, media fitting) and turns the ROOT into a wrapped multicol container:
 * two columns per row (one in the narrow-window fallback), each column one page of text, rows stacking vertically.
 *
 * Specificity: compileStyle's `<style id="er-style">` stays last (PRD §10.4 step 3) and forces
 * `html, body, body * { column-count: 1 !important; … }`. For !important declarations from the same
 * origin the higher specificity wins regardless of order, so these rules use `:root:root` (0,2,0),
 * `:root > body` and `:root body *` (0,1,1) to beat `html`/`body`/`body *` (0,0,1). Descendants
 * are reset to `column-count: auto` (not 1) so they are plain blocks, not nested one-column
 * multicol containers, which would fragment inside each page at extra layout cost.
 */
import { frameBaseCss } from '../flow/frameCss';
import type { GridGeometry } from './gridMath';

export function gridFrameCss(g: GridGeometry): string {
  return `${frameBaseCss({ mediaMaxHeightPx: g.textH })}
:root:root {
  box-sizing: content-box !important;
  padding: ${g.marginY}px 0 !important;
  height: auto !important; min-height: 0 !important; max-height: none !important;
  columns: auto !important;
  column-count: ${g.cols} !important;
  column-width: auto !important;
  column-gap: ${g.colGap}px !important;
  row-gap: ${2 * g.marginY + g.gapPx}px !important;
  column-height: ${g.textH}px !important;
  column-wrap: wrap !important;
  column-fill: auto !important;
  column-rule: none !important;
}
:root > body, :root body *, :root body *::before, :root body *::after {
  columns: auto !important;
  column-count: auto !important;
  column-width: auto !important;
  column-span: none !important;
}
:root img, :root svg, :root video, :root canvas, :root object, :root embed {
  max-width: 100% !important; max-height: ${Math.max(16, g.textH)}px !important;
  break-inside: avoid !important;
}
`;
}
