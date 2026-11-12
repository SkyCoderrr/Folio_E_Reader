/**
 * Renderer-owned structural CSS for section documents in paged flow (ADR-004). Starts from the
 * flow base CSS (one column on every descendant, no html/body margins, horizontal writing, media
 * fitting) and turns the ROOT into a fixed-size horizontal multicol container: `cols` columns of
 * exactly textW × textH per view, overflow columns continuing to the right at a constant pitch.
 *
 * The root width is fixed in CSS (not taken from the iframe), so widening the iframe to hold every
 * column never changes the column width. Specificity scheme: `:root:root`
 * (0,2,0) beats compileStyle's `html, body, body * { column-count: 1 !important }` (0,0,1), which
 * still keeps every descendant single-column. One page therefore stays ONE text column at every
 * window width (LM-03, verified at 3440 px in PaginatorRenderer.test.ts).
 */
import { frameBaseCss } from '../flow/frameCss';
import type { PagedGeometry } from './pagedMath';

export function pagedFrameCss(g: PagedGeometry): string {
  return `${frameBaseCss({ mediaMaxHeightPx: g.textH })}
:root:root {
  box-sizing: content-box !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important;
  width: ${g.frameW}px !important; min-width: 0 !important; max-width: none !important;
  height: ${g.textH}px !important; min-height: 0 !important; max-height: none !important;
  columns: auto !important;
  column-count: ${g.cols} !important;
  column-width: ${g.textW}px !important;
  column-gap: ${g.colGap}px !important;
  column-fill: auto !important;
  column-rule: none !important;
  overflow: hidden !important;
}
:root > body, :root body *, :root body *::before, :root body *::after {
  columns: auto !important;
  column-count: auto !important;
  column-width: auto !important;
  column-span: none !important;
}
:root > body { height: auto !important; min-height: 0 !important; max-height: none !important; }
:root img, :root svg, :root video, :root canvas, :root object, :root embed {
  max-width: 100% !important; max-height: ${Math.max(16, g.textH)}px !important;
  break-inside: avoid !important;
}
`;
}
