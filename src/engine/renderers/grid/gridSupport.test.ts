import { describe, expect, it } from 'vitest';
import { gridFrameCss } from './gridCss';
import { gridGeometry } from './gridMath';
import { checkProbeGeometry, detectGridSupport, supportsColumnWrap, type CssSupports } from './gridSupport';

const css = (ok: Record<string, boolean>): CssSupports => ({
  supports: (p: string) => ok[p] ?? false,
});

describe('supportsColumnWrap', () => {
  it('needs both column-wrap and column-height', () => {
    expect(supportsColumnWrap(css({ 'column-wrap': true, 'column-height': true }))).toBe(true);
    expect(supportsColumnWrap(css({ 'column-wrap': true }))).toBe(false);
    expect(supportsColumnWrap(css({ 'column-height': true }))).toBe(false);
  });

  it('is false without CSS.supports or when it throws', () => {
    expect(supportsColumnWrap(undefined)).toBe(false);
    expect(
      supportsColumnWrap({
        supports: () => {
          throw new Error('x');
        },
      }),
    ).toBe(false);
  });
});

describe('checkProbeGeometry', () => {
  it('passes for real row wrapping (column 3 at row 2, left edge)', () => {
    expect(checkProbeGeometry({ top: 0, left: 110 }, { top: 60, left: 0 }, 160)).toBeNull();
  });

  it('fails when the third column overflows horizontally (no wrapping)', () => {
    expect(checkProbeGeometry({ top: 0, left: 110 }, { top: 0, left: 220 }, 40)).toMatch(/no row wrapping/);
  });

  it('fails when row-gap is ignored between rows', () => {
    expect(checkProbeGeometry({ top: 0, left: 110 }, { top: 40, left: 0 }, 120)).not.toBeNull();
  });

  it('fails when the container does not grow to hold all rows', () => {
    expect(checkProbeGeometry({ top: 0, left: 110 }, { top: 60, left: 0 }, 40)).toMatch(/container/);
  });
});

describe('detectGridSupport', () => {
  it('reports no-dom outside a browser', () => {
    expect(detectGridSupport(undefined, css({})).reason).toBe('no-dom');
  });

  it('skips the layout probe when the properties do not parse', () => {
    const doc = {} as Document; // the probe would throw on this
    const r = detectGridSupport(doc, css({ 'column-wrap': false }));
    expect(r).toMatchObject({ supported: false, reason: 'properties-unsupported' });
  });
});

describe('gridFrameCss', () => {
  const g = gridGeometry({
    viewportW: 1600,
    viewportH: 900,
    gapPx: 48,
    marginXPx: 48,
    marginYPx: 40,
    maxLineWidthPx: 720,
  });
  const out = gridFrameCss(g);

  it('makes the root a wrapped two-column multicol of page-sized columns', () => {
    expect(out).toContain('column-count: 2 !important');
    expect(out).toContain(`column-height: ${g.textH}px !important`);
    expect(out).toContain('column-wrap: wrap !important');
    expect(out).toContain(`column-gap: ${g.colGap}px !important`);
    expect(out).toContain(`row-gap: ${2 * g.marginY + g.gapPx}px !important`);
    expect(out).toContain(`padding: ${g.marginY}px 0 !important`);
    expect(out).toContain('column-fill: auto !important');
  });

  it("out-specifies compileStyle's forced single column (html/body/body *)", () => {
    const root = out.indexOf(':root:root');
    expect(root).toBeGreaterThan(out.indexOf('html {')); // after the flow base CSS
    expect(out).toMatch(/:root > body, :root body \*, :root body \*::before, :root body \*::after/);
    expect(out).toContain('column-count: auto !important');
  });

  it('fits media to one page of text', () => {
    expect(out).toContain(`max-height: ${g.textH}px !important`);
  });
});
