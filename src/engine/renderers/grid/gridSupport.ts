/**
 * Runtime feature detection for candidate A (ADR-002): CSS Multicol Level 2 `column-height` +
 * `column-wrap: wrap`, plus `row-gap` between wrapped rows. Two steps:
 *  1. `CSS.supports` for both properties (cheap; false on engines that do not parse them);
 *  2. a one-off layout probe: a tiny wrapped multicol in the app document, checking that the third
 *     column really starts on a second row at `column-height + row-gap`, and that the container
 *     grows to hold every row. Parsing a property is not proof that layout implements it.
 * The result is cached per document. createRenderer falls back to FlowRenderer when it is false.
 */

export interface CssSupports {
  supports(property: string, value: string): boolean;
}

export type GridSupportReason = 'ok' | 'no-dom' | 'properties-unsupported' | 'layout-mismatch';

export interface GridSupport {
  supported: boolean;
  reason: GridSupportReason;
  /** Human-readable detail for logs / the dev overlay. */
  detail: string;
}

/** Step 1: both Multicol Level 2 properties parse. */
export function supportsColumnWrap(css: CssSupports | undefined): boolean {
  if (!css || typeof css.supports !== 'function') return false;
  try {
    return css.supports('column-wrap', 'wrap') && css.supports('column-height', '40px');
  } catch {
    return false;
  }
}

/** Probe constants: 4 lines of 10 px per 40 px column, 2 columns of 100 px per row, 20 px row gap. */
const PROBE = { colW: 100, gap: 10, colH: 40, rowGap: 20, lineH: 10, lines: 20 } as const;

export interface ProbeBox {
  top: number;
  left: number;
}

/**
 * Pure check of probe geometry (relative to the container): line 4 starts column 2 at the top of
 * row 0, line 8 starts column 3 at the left of row 1, and the container is at least 3 rows tall.
 */
export function checkProbeGeometry(line4: ProbeBox, line8: ProbeBox, containerH: number): string | null {
  const P = PROBE;
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  const rowPitch = P.colH + P.rowGap;
  if (!near(line4.top, 0) || !near(line4.left, P.colW + P.gap)) {
    return `second column at (${line4.left}, ${line4.top}), expected (${P.colW + P.gap}, 0)`;
  }
  if (!near(line8.left, 0) || !near(line8.top, rowPitch)) {
    return `third column at (${line8.left}, ${line8.top}), expected (0, ${rowPitch}): no row wrapping`;
  }
  const minH = 2 * rowPitch + P.lineH * 4 - 1;
  if (containerH < minH) return `container ${containerH}px tall, expected ≥ ${minH}px`;
  return null;
}

/** Step 2: lay out a tiny wrapped multicol offscreen in `doc` and check the geometry. */
export function probeColumnWrapLayout(doc: Document): string | null {
  const P = PROBE;
  const host = doc.body ?? doc.documentElement;
  if (!host) return 'no document body';
  const box = doc.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = [
    'position:absolute', 'left:-10000px', 'top:0', 'visibility:hidden', 'contain:layout',
    'margin:0', 'padding:0', 'border:0', 'box-sizing:content-box',
    `width:${2 * P.colW + P.gap}px`, 'height:auto',
    'column-count:2', `column-gap:${P.gap}px`, `row-gap:${P.rowGap}px`,
    `column-height:${P.colH}px`, 'column-wrap:wrap', 'column-fill:auto',
    `font-size:8px`, `line-height:${P.lineH}px`,
  ].join(';');
  for (let k = 0; k < P.lines; k++) {
    const line = doc.createElement('div');
    line.style.cssText = `height:${P.lineH}px;margin:0;padding:0`;
    box.append(line);
  }
  host.append(box);
  try {
    const c = box.getBoundingClientRect();
    const rel = (k: number): ProbeBox => {
      const r = (box.children[k] as HTMLElement).getBoundingClientRect();
      return { top: Math.round(r.top - c.top), left: Math.round(r.left - c.left) };
    };
    return checkProbeGeometry(rel(4), rel(8), Math.round(c.height));
  } finally {
    box.remove();
  }
}

const cache = new WeakMap<Document, GridSupport>();

/** Cached two-step detection. Safe to call outside a browser (returns `no-dom`). */
export function detectGridSupport(
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
  css: CssSupports | undefined = typeof CSS === 'undefined' ? undefined : CSS,
): GridSupport {
  if (!doc) return { supported: false, reason: 'no-dom', detail: 'no document' };
  const hit = cache.get(doc);
  if (hit) return hit;
  let out: GridSupport;
  if (!supportsColumnWrap(css)) {
    out = {
      supported: false,
      reason: 'properties-unsupported',
      detail: 'CSS.supports: column-wrap: wrap / column-height not supported',
    };
  } else {
    const err = probeColumnWrapLayout(doc);
    out = err
      ? { supported: false, reason: 'layout-mismatch', detail: err }
      : { supported: true, reason: 'ok', detail: 'column-wrap layout probe passed' };
  }
  cache.set(doc, out);
  return out;
}
