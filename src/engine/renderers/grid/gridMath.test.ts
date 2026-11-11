import { describe, expect, it } from 'vitest';
import type { SectionFrame } from '../flow/sectionFrame';
import { rowAligned } from './gridAnchor';
import { gridFrameCss } from './gridCss';
import {
  effectivePages,
  firstVisibleProbe,
  gridGeometry,
  gridPageStep,
  gridPxPerUnit,
  pageAt,
  readingKey,
  rowAlign,
  rowOf,
  rowsForHeight,
  sectionEdgeY,
  snapToRows,
} from './gridMath';

const base = { viewportW: 1600, viewportH: 900, gapPx: 48, marginXPx: 48, marginYPx: 40, maxLineWidthPx: 720 };

describe('gridGeometry (row geometry)', () => {
  it('splits the viewport into two pages, each one viewport tall', () => {
    const g = gridGeometry(base);
    expect(g.pageH).toBe(900);
    expect(g.rowH).toBe(948);
    expect(g.pageW).toBe(776); // (1600 − 48) / 2
    expect(g.textW).toBe(680); // 776 − 2·48, under the 720 cap
    expect(g.pageInset).toBe(48);
    expect(g.colGap).toBe(144); // 48 + 48 gap + 48
    expect(g.frameLeft).toBe(48);
    expect(g.frameW).toBe(2 * 680 + 144);
    expect(g.textH).toBe(820);
  });

  it('caps the text column at maxLineWidth and centres it in each page', () => {
    const g = gridGeometry({ ...base, viewportW: 2560 });
    expect(g.pageW).toBe(1256);
    expect(g.textW).toBe(720);
    const rightTextX = g.frameLeft + g.textW + g.colGap;
    expect(rightTextX).toBe(g.spreadLeft + g.pageW + g.gapPx + g.pageInset);
    expect(g.frameLeft + g.frameW).toBe(g.spreadLeft + 2 * g.pageW + g.gapPx - g.pageInset);
  });

  it('fills the page when maxLineWidth is null, never exceeds the viewport', () => {
    for (const w of [301, 999, 1601, 3441]) {
      const g = gridGeometry({ ...base, viewportW: w, maxLineWidthPx: null });
      expect(2 * g.pageW + g.gapPx).toBeLessThanOrEqual(w);
      expect(g.textW).toBeLessThanOrEqual(g.pageW);
      expect(g.textW).toBeGreaterThan(0);
    }
  });

  it('row pitch = text height + 2·marginY, so padding + row-gap put row r at r·rowH', () => {
    const g = gridGeometry(base);
    expect(g.textH + 2 * g.marginY + g.gapPx).toBe(g.rowH);
    // html padding-top marginY, then rows of textH separated by row-gap 2·marginY:
    const textTopOfRow = (r: number): number => g.marginY + r * (g.textH + 2 * g.marginY + g.gapPx);
    expect(textTopOfRow(3)).toBe(3 * g.rowH + g.marginY);
  });

  it('shrinks the vertical margins on very short viewports', () => {
    const g = gridGeometry({ ...base, viewportH: 100 });
    expect(g.textH).toBeGreaterThanOrEqual(48);
    expect(g.textH + 2 * g.marginY).toBe(100);
  });
});

describe('rows', () => {
  it('quantizes measured heights to whole rows with 1 px tolerance', () => {
    expect(rowsForHeight(0, 900)).toBe(1);
    expect(rowsForHeight(900, 900)).toBe(1);
    expect(rowsForHeight(901, 900)).toBe(1);
    expect(rowsForHeight(902, 900)).toBe(2);
    expect(rowsForHeight(9000, 900)).toBe(10);
  });

  it('snaps estimates up to whole rows, at least one', () => {
    expect(snapToRows(1, 900)).toBe(900);
    expect(snapToRows(900, 900)).toBe(900);
    expect(snapToRows(901, 900)).toBe(1800);
  });

  it('maps a y to its row and aligns to the row top', () => {
    expect(rowOf(0, 900)).toBe(0);
    expect(rowOf(899, 900)).toBe(0);
    expect(rowOf(900, 900)).toBe(1);
    expect(rowOf(-5, 900)).toBe(0);
    expect(rowAlign(5000, 3600, 900)).toBe(4500);
    expect(rowAlign(3600, 3600, 900)).toBe(3600);
  });
});

describe('page → row mapping and reading order', () => {
  const g = gridGeometry(base);
  const rightX = g.textW + g.colGap + 10;

  it('numbers pages left-right, then down', () => {
    expect(pageAt(10, 100, g)).toBe(0);
    expect(pageAt(rightX, 100, g)).toBe(1);
    expect(pageAt(10, g.rowH + 100, g)).toBe(2);
    expect(pageAt(rightX, 2 * g.rowH + 5, g)).toBe(5);
  });

  it('reading key is monotonic across the page boundaries (unlike raw y)', () => {
    const leftBottom = readingKey(10, g.rowH - g.marginY - 1, g);
    const rightTop = readingKey(rightX, g.marginY, g);
    const nextLeftTop = readingKey(10, g.rowH + g.marginY, g);
    expect(rightTop).toBeGreaterThan(leftBottom);
    expect(nextLeftTop).toBeGreaterThan(readingKey(rightX, g.rowH - g.marginY - 1, g));
  });
});

describe('first visible line probe', () => {
  const g = gridGeometry(base);
  const lh = 35;

  it('uses the text-area top when the viewport top is in the page margin', () => {
    expect(firstVisibleProbe(0, g, lh)).toEqual({ row: 0, y: g.marginY });
    expect(firstVisibleProbe(g.rowH + 10, g, lh)).toEqual({ row: 1, y: g.rowH + g.marginY });
  });

  it('uses the viewport top inside the text area', () => {
    expect(firstVisibleProbe(g.rowH + 300, g, lh)).toEqual({ row: 1, y: g.rowH + 300 });
  });

  it('moves to the next row when the row has less than half a line of text left in view', () => {
    expect(firstVisibleProbe(g.rowH + g.pageH - g.marginY - 5, g, lh)).toEqual({
      row: 2,
      y: 2 * g.rowH + g.marginY,
    });
  });
});

describe('paging and estimation', () => {
  it('page step = exactly one row = one viewport, no overlap lines', () => {
    const g = gridGeometry(base);
    expect(gridPageStep(g)).toBe(948);
    expect(gridPageStep(gridGeometry({ ...base, viewportH: 1337 }))).toBe(1385);
  });

  it('Home/End go to the first row, or the last row so the final spread is fully in view', () => {
    expect(sectionEdgeY(3600, 2700, 900, 'start')).toBe(3600);
    expect(sectionEdgeY(3600, 2700, 900, 'end')).toBe(3600 + 1800);
    expect(sectionEdgeY(3600, 900, 900, 'end')).toBe(3600);
  });

  it('converts the single-column prior to grid px (two pages of textH per rowH)', () => {
    const g = gridGeometry(base);
    expect(gridPxPerUnit(0.1, g)).toBeCloseTo((0.1 * 900) / (2 * 820));
  });
});

describe('locator → row (row-aligned placement)', () => {
  const frame = {} as SectionFrame;

  it('puts the row containing the target line at the viewport top', () => {
    const range = {} as Range;
    const place = rowAligned((_f, top) => ({ y: top + 2500, range }), () => 900);
    expect(place(frame, 3600)).toEqual({ y: 3600 + 1800, range });
  });

  it('reads the row height at placement time (viewport may change while a section loads)', () => {
    let rowH = 900;
    const place = rowAligned((_f, top) => ({ y: top + 1000, range: null }), () => rowH);
    rowH = 400;
    expect(place(frame, 0)?.y).toBe(800);
  });

  it('propagates a failed placement', () => {
    expect(rowAligned(() => null, () => 900)(frame, 0)).toBeNull();
  });
});

describe('narrow-window fallback (FR-LM-3, LM-04, LM-07)', () => {
  it('two pages show one page below minSpreadWidthPx and two again at or above it', () => {
    expect(effectivePages(2, 999, 1000)).toBe(1);
    expect(effectivePages(2, 1000, 1000)).toBe(2);
    expect(effectivePages(2, 3440, 1000)).toBe(2);
    expect(effectivePages(2, 1500, 1600)).toBe(1);
  });

  it('never shows two pages for a one-page request, at any width', () => {
    for (const w of [480, 1000, 2560, 3440, 10000]) expect(effectivePages(1, w, 600)).toBe(1);
  });

  it('one-page rows: a single text column as wide as the viewport allows, centred', () => {
    const g = gridGeometry({ ...base, viewportW: 900, cols: 1 });
    expect(g.cols).toBe(1);
    expect(g.pageW).toBe(900);
    expect(g.spreadLeft).toBe(0);
    expect(g.textW).toBe(720);
    expect(g.frameW).toBe(g.textW);
    expect(g.frameLeft).toBe(90);
    expect(gridFrameCss(g)).toContain('column-count: 1 !important');
    expect(gridFrameCss(gridGeometry(base))).toContain('column-count: 2 !important');
  });

  it('one-page rows: page index and reading key advance one page per row', () => {
    const g = gridGeometry({ ...base, viewportW: 900, cols: 1 });
    expect(pageAt(g.frameW - 1, 10, g)).toBe(0);
    expect(pageAt(10, g.rowH + 10, g)).toBe(1);
    expect(readingKey(g.frameW - 1, g.rowH - 50, g)).toBeLessThan(readingKey(0, g.rowH + 10, g));
    expect(gridPxPerUnit(1, g)).toBeCloseTo(g.rowH / g.textH); // one column of text per row
  });
});
