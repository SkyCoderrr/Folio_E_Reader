/**
 * Two-page desk and page-edge colours (PRD §6.7 "Reader, scroll flow, two pages", M6.2), shared by
 * PageGridRenderer and PaginatorRenderer:
 *  - page background = theme background;
 *  - desk around the pages = background mixed 5% toward the text colour (all themes);
 *  - page edge = 1 px at 6% text colour (text mixed 6% into the page background).
 * A theme is dark when its background is darker than its text. Results are CSS `color-mix()`
 * strings (WebView2 supports them), so no colour maths runs per frame.
 */
import type { CompiledStyle } from '../../style/types';

export const DESK_MIX_PCT = 5;
export const EDGE_MIX_PCT = 6;

export interface DeskColors {
  page: string;
  desk: string;
  edge: string;
  dark: boolean;
}

type Rgb = [number, number, number];

function parseHex(input: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** WCAG relative luminance (0 black … 1 white). */
export function relativeLuminance(hex: string): number | null {
  const c = parseHex(hex);
  if (!c) return null;
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Dark theme = background darker than the text (falls back to background luminance < 0.5). */
export function isDarkTheme(s: Pick<CompiledStyle, 'background' | 'foreground'>): boolean {
  const bg = relativeLuminance(s.background);
  const fg = relativeLuminance(s.foreground);
  if (bg === null) return false;
  return fg === null ? bg < 0.5 : bg < fg;
}

export function deskColors(s: Pick<CompiledStyle, 'background' | 'foreground'>): DeskColors {
  const dark = isDarkTheme(s);
  // 2026-11-10: always a subtle preset-derived tone (background mixed toward the text colour),
  // never black, so the gutter is not dark on light presets.
  return {
    page: s.background,
    desk: `color-mix(in srgb, ${s.foreground} ${DESK_MIX_PCT}%, ${s.background})`,
    edge: `color-mix(in srgb, ${s.foreground} ${EDGE_MIX_PCT}%, ${s.background})`,
    dark,
  };
}

export interface PageRect {
  /** Left edge of the page in the painted box, px. */
  x: number;
  width: number;
}

/**
 * Background layers that paint the desk and 1 px page edges over a box whose pages are `pages`
 * (x/width) and whose rows repeat every `rowH` px (0 = one full-height row: side edges only).
 * `boxW` is only a hint (0 = unknown): the desk always reaches the box's right edge.
 * Returned as the four background-* properties for one element.
 */
export function deskLayers(
  c: DeskColors,
  pages: PageRect[],
  boxW: number,
  rowH: number,
  gapPx = 0,
): { backgroundImage: string; backgroundRepeat: string; backgroundSize: string; backgroundPosition: string } {
  const img: string[] = [];
  const rep: string[] = [];
  const size: string[] = [];
  const pos: string[] = [];
  const add = (i: string, r: string, s: string, p: string): void => {
    img.push(i);
    rep.push(r);
    size.push(s);
    pos.push(p);
  };
  const solid = (col: string): string => `linear-gradient(${col}, ${col})`;
  const rowH1 = Math.max(1, Math.round(rowH));
  if (rowH > 0 && gapPx > 0) {
    const pageH = Math.max(1, rowH1 - gapPx);
    add(`linear-gradient(to bottom, transparent ${pageH - 1}px, ${c.edge} ${pageH - 1}px, ${c.edge} ${pageH}px, ${c.desk} ${pageH}px)`, 'repeat-y', ` 100% ${rowH1}px`, '0 0');
  }
  for (const p of pages) {
    const w = Math.max(0, Math.round(p.width));
    const x = Math.round(p.x);
    if (w <= 0) continue;
    // Top edge of every row's page (rows touch, so it doubles as the bottom edge of the row
    // above and stays 1 px), then the left and right edge.
    const band = `linear-gradient(to bottom, ${c.edge} 0, ${c.edge} 1px, transparent 1px)`;
    if (rowH > 0) add(band, 'repeat-y', `${w}px ${rowH1}px`, `${x}px 0`);
    add(solid(c.edge), 'no-repeat', `1px 100%`, `${x}px 0`);
    add(solid(c.edge), 'no-repeat', `1px 100%`, `${x + w - 1}px 0`);
  }
  // Desk: everything that is not a page (sides and gutters), as no-repeat vertical bands.
  const sorted = [...pages].sort((a, b) => a.x - b.x);
  let cursor = 0;
  const desk = (from: number, to: number): void => {
    const w = Math.round(to - from);
    if (w > 0) add(solid(c.desk), 'no-repeat', `${w}px 100%`, `${Math.round(from)}px 0`);
  };
  for (const p of sorted) {
    desk(cursor, p.x);
    cursor = Math.max(cursor, p.x + p.width);
  }
  // The last band runs to the box's right edge, whatever its current width.
  const tail = Math.round(cursor);
  if (boxW <= 0 || tail < boxW) add(solid(c.desk), 'no-repeat', `calc(100% - ${tail}px) 100%`, `${tail}px 0`);
  return {
    backgroundImage: img.join(', '),
    backgroundRepeat: rep.join(', '),
    backgroundSize: size.join(', '),
    backgroundPosition: pos.join(', '),
  };
}
