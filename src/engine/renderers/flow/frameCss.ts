/**
 * Renderer-owned structural CSS for every section document in scroll flow, injected as
 * `<style id="er-base">` just before compileStyle's `<style id="er-style">` (which stays last).
 * It guarantees what the flow layout depends on, regardless of publisher CSS or compileStyle:
 *  - exactly one text column at any width (LM-01), on every element;
 *  - auto-height root so the iframe can be sized to its content (no internal scrolling);
 *  - no html/body margins (the renderer owns geometry, see style/types.ts);
 *  - horizontal writing (vertical-rl books are out of scope for v1 scroll flow, ADR-001);
 *  - media fitted to the column and to one screen height (like foliate-js `setImageSize`).
 */
export interface FrameCssOptions {
  /** Max media height in px: viewport height minus vertical margins. */
  mediaMaxHeightPx: number;
}

export function frameBaseCss(o: FrameCssOptions): string {
  const mediaMax = Math.max(100, Math.round(o.mediaMaxHeightPx));
  return `
html {
  margin: 0 !important; padding: 0 !important; border: 0 !important;
  width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important;
  overflow: hidden !important; writing-mode: horizontal-tb !important;
  column-count: auto !important; column-width: auto !important;
  -webkit-text-size-adjust: none;
}
body {
  margin: 0 !important; padding: 0 !important; border: 0 !important;
  width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important;
  overflow: visible !important; writing-mode: horizontal-tb !important;
  overflow-wrap: break-word;
}
*, *::before, *::after {
  scroll-behavior: auto !important; scroll-snap-type: none !important;
  scroll-snap-align: none !important; overflow-anchor: none !important;
  column-count: auto !important; column-width: auto !important; column-span: none !important;
}
img, svg, video, canvas, object, embed {
  max-width: 100% !important; max-height: ${mediaMax}px !important;
  object-fit: contain; box-sizing: border-box; break-inside: avoid;
}
`;
}
