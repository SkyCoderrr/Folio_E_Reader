import { describe, expect, it } from 'vitest';
import { pagedFrameCss } from './pagedCss';
import {
  clickZone,
  columnOfX,
  columnsForRight,
  pagedGeometry,
  pagedKey,
  STEP_MS,
  stripFrameWidth,
  wholeLines,
  WheelPager,
} from './pagedMath';

const base = { viewportH: 1000, gapPx: 48, marginXPx: 48, marginYPx: 40, maxLineWidthPx: 648 as number | null };

describe('pagedGeometry: one page = one text column at every width (LM-03)', () => {
  it.each([480, 800, 1280, 1920, 2560, 3440, 5120])('one page at %i px shows exactly one column', (w) => {
    const g = pagedGeometry({ ...base, viewportW: w, cols: 1 });
    expect(g.cols).toBe(1);
    expect(g.frameW).toBe(g.textW); // the root is exactly one column wide
    // The clip box shows the column plus overhang, never any part of a neighbouring column.
    expect(g.clipLeft + g.clipW).toBeLessThanOrEqual(g.frameLeft + g.pitch);
    expect(g.clipLeft).toBeGreaterThanOrEqual(g.frameLeft - g.pitch + g.textW);
    const css = pagedFrameCss(g);
    expect(css).toContain('column-count: 1 !important');
    expect(css).toContain(`width: ${g.frameW}px !important`);
    expect(css).toContain(`column-width: ${g.textW}px !important`);
  });

  it('at 3440 px the column honours max line width and stays centred', () => {
    const g = pagedGeometry({ ...base, viewportW: 3440, cols: 1 });
    expect(g.textW).toBe(648);
    expect(g.frameLeft).toBe((3440 - 648) / 2);
    expect(g.textH).toBe(1000 - 80);
    // Even with no line-width cap the page is one (very wide) column, never two.
    const wide = pagedGeometry({ ...base, viewportW: 3440, maxLineWidthPx: null, cols: 1 });
    expect(wide.textW).toBe(3440 - 96);
    expect(pagedFrameCss(wide)).toContain('column-count: 1 !important');
  });

  it('two pages: a spread of two columns separated by both insets and the page gap', () => {
    const g = pagedGeometry({ ...base, viewportW: 1600, cols: 2 });
    expect(g.pageW).toBe(776);
    expect(g.textW).toBe(648);
    expect(g.colGap).toBe(776 - 648 + 48);
    expect(g.frameW).toBe(2 * 648 + g.colGap);
    expect(pagedFrameCss(g)).toContain('column-count: 2 !important');
    // The next spread's first column starts beyond the clip box.
    expect(g.frameLeft + 2 * g.pitch).toBeGreaterThanOrEqual(g.clipLeft + g.clipW);
  });

  it('two pages: the column pitch is the page pitch (page width + gap), so the strip steps by pages', () => {
    const g = pagedGeometry({ ...base, viewportW: 1600, cols: 2 });
    expect(g.pitch).toBe(g.pageW + g.gapPx);
    expect(g.frameLeft + g.pitch).toBe(g.spreadLeft + g.pitch + g.pageInset); // right page text
  });

  it('a section iframe is exactly its strip length, so it never covers the next section', () => {
    for (const cols of [1, 2] as const) {
      const g = pagedGeometry({ ...base, viewportW: 1600, cols });
      expect(stripFrameWidth(5, g)).toBe(5 * g.pitch);
      expect(stripFrameWidth(1, g)).toBeGreaterThanOrEqual(g.textW);
      expect(stripFrameWidth(0, g)).toBe(g.pitch);
    }
    // CSS never animates: the strip motion writes transforms itself (ADR-005).
    expect(pagedFrameCss(pagedGeometry({ ...base, viewportW: 1600, cols: 2 }))).not.toMatch(
      /transition|animation|scroll-behavior: smooth/,
    );
    expect(STEP_MS).toBeGreaterThanOrEqual(150);
    expect(STEP_MS).toBeLessThanOrEqual(200);
  });
});

describe('column bookkeeping', () => {
  const pitch = 700;
  it('counts columns from the content right edge', () => {
    expect(columnsForRight(0, pitch)).toBe(1);
    expect(columnsForRight(648, pitch)).toBe(1);
    expect(columnsForRight(701, pitch)).toBe(2);
    expect(columnsForRight(3 * pitch + 10, pitch)).toBe(4);
  });
  it('maps a document x to its column', () => {
    expect(columnOfX(1401, pitch)).toBe(2);
    expect(columnOfX(-5, pitch)).toBe(0);
  });
  it('the reading key is monotonic across columns', () => {
    const g = { pitch, textH: 900 };
    expect(pagedKey(10, 890, g)).toBeLessThan(pagedKey(pitch + 1, 5, g));
  });
});

describe('input', () => {
  it('click zones: left third back, right third forward, middle nothing', () => {
    expect(clickZone(10, 0, 900)).toBe(-1);
    expect(clickZone(450, 0, 900)).toBe(0);
    expect(clickZone(890, 0, 900)).toBe(1);
    expect(clickZone(1250, 1000, 300)).toBe(1);
  });

  it('wheel: one notch turns one page; a continuous gesture (inertia) turns only one', () => {
    const w = new WheelPager();
    expect(w.feed(100, 0, 0)).toBe(1);
    let turns = 0;
    for (let t = 16; t < 600; t += 16) turns += Math.abs(w.feed(30, 0, t));
    expect(turns).toBe(0);
    expect(w.feed(100, 0, 1000)).toBe(1); // after a quiet gap
    expect(w.feed(-3, 1, 1400)).toBe(-1); // line mode: one 3-line notch = 48 px
  });

  it('wheel: small deltas accumulate; direction changes reset', () => {
    const w = new WheelPager();
    expect(w.feed(15, 0, 0)).toBe(0);
    expect(w.feed(15, 0, 10)).toBe(0);
    expect(w.feed(15, 0, 20)).toBe(1);
    w.reset();
    expect(w.feed(25, 0, 1000)).toBe(0);
    expect(w.feed(-25, 0, 1010)).toBe(0);
    expect(w.feed(-25, 0, 1020)).toBe(-1);
  });
});

describe('wholeLines / pagedGeometry lineHeightPx (t24u: no uneven empty band at the bottom)', () => {
  const lh = 35;
  it.each([800, 1032, 1080, 1440, 2160])('at %i px tall the text box is whole lines and the margins match', (h) => {
    const g = pagedGeometry({ ...base, viewportH: h, viewportW: 1920, cols: 2, lineHeightPx: lh });
    expect(g.textH % lh).toBe(0);
    expect(g.textH).toBeLessThanOrEqual(h - 80);
    const top = g.marginY;
    const bottom = h - g.marginY - g.textH;
    expect(top).toBeGreaterThanOrEqual(40);
    expect(Math.abs(bottom - top)).toBeLessThanOrEqual(1);
    expect(h - bottom - top).toBe(g.textH); // nothing else is lost
  });
  it('no line height keeps the plain geometry; tiny pages are left alone', () => {
    expect(pagedGeometry({ ...base, viewportW: 1920, cols: 2 }).textH).toBe(920);
    expect(wholeLines(40, 60, 35)).toEqual({ marginY: 40, textH: 60 });
    expect(wholeLines(40, 920, 35)).toEqual({ marginY: 40 + 5, textH: 910 });
  });
  // t28u/t30u: the owner's second display (2560x1600 at 150 %) gives fractional CSS viewports when
  // maximized (1019.33) and in F11 (1067.33). The page box must stay centred there too: the strip
  // he saw is native (see .agent-logs, fb3), not a lopsided page box.
  it.each([
    [1707.33, 1019.33],
    [1707.33, 1067.33],
    [1920, 1032],
    [1920, 1080],
  ])('at %f x %f (maximized / F11, 100 %% and 150 %%) top and bottom margins match', (w, h) => {
    for (const cols of [1, 2] as const) {
      const g = pagedGeometry({ ...base, viewportH: h, viewportW: w, cols, lineHeightPx: lh });
      const bottom = h - g.marginY - g.textH;
      expect(g.textH % lh).toBe(0);
      expect(Math.abs(bottom - g.marginY)).toBeLessThanOrEqual(1.5);
      expect(bottom).toBeLessThan(base.marginYPx + lh); // never a line-sized empty band
    }
  });
  it('fractional line heights never lose a line to rounding', () => {
    const w = wholeLines(40, 952, 28.875);
    expect(Math.floor(w.textH / 28.875)).toBe(Math.floor(952 / 28.875));
  });
});
