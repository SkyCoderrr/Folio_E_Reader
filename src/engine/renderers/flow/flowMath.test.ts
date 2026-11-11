import { describe, it, expect } from 'vitest';
import {
  anchorCorrection,
  bookProgress,
  columnWidth,
  locateProgress,
  MIN_COLUMN_PX,
  pageStep,
  ScrollVelocity,
  separatorHeight,
} from './flowMath';
import { SlotLayout } from './slotLayout';

describe('pageStep (LM-06)', () => {
  it('is viewport minus overlapLines × line height', () => {
    expect(pageStep(800, 35, 2)).toBe(730);
    expect(pageStep(800, 35, 0)).toBe(800);
  });
  it('follows the current line height after a font change', () => {
    expect(pageStep(800, 70, 2)).toBe(660);
  });
  it('is never less than one line, even in a tiny viewport', () => {
    expect(pageStep(100, 35, 10)).toBe(35);
  });
  it('rounds fractional line heights to integer px', () => {
    expect(pageStep(1000, 33.25, 2)).toBe(934);
  });
});

describe('columnWidth', () => {
  it('is capped by the max line width and centred by the caller', () => {
    expect(columnWidth(3440, 48, 720)).toBe(720);
  });
  it('fills the viewport minus margins when max line width is 0/null', () => {
    expect(columnWidth(1280, 48, null)).toBe(1184);
    expect(columnWidth(1280, 48, 0)).toBe(1184);
  });
  it('shrinks with the window but never below the minimum column', () => {
    expect(columnWidth(600, 48, 720)).toBe(504);
    expect(columnWidth(480, 400, 720)).toBe(MIN_COLUMN_PX);
    expect(columnWidth(100, 0, 720)).toBe(100);
  });
});

describe('separatorHeight', () => {
  it('is at least 48 px or 3 lines', () => {
    expect(separatorHeight(10)).toBe(48);
    expect(separatorHeight(35)).toBe(105);
  });
});

describe('anchorCorrection (scroll anchoring)', () => {
  it('corrects by the height delta when a section above is measured (prepend)', () => {
    // Reading section 3; section 2 above was an estimate of 3000 px and measures 4200 px.
    const l = new SlotLayout(5, { padTop: 40, padBottom: 40, separatorPx: 100 }, 3000);
    const st = l.contentTop(3) + 500;
    const before = { contentTop: l.contentTop(3), innerY: 500, scrollTop: st };
    l.setContentHeight(2, 4200, true);
    const after = { contentTop: l.contentTop(3), innerY: 500, scrollTop: st };
    expect(anchorCorrection(before, after)).toBe(1200);
  });
  it('returns 0 when native CSS anchoring already adjusted scrollTop', () => {
    const before = { contentTop: 10000, innerY: 500, scrollTop: 10500 };
    const after = { contentTop: 11200, innerY: 500, scrollTop: 11700 };
    expect(anchorCorrection(before, after)).toBe(0);
  });
  it('returns only the residual when native anchoring was partial', () => {
    const before = { contentTop: 10000, innerY: 500, scrollTop: 10500 };
    const after = { contentTop: 11200, innerY: 500, scrollTop: 11000 };
    expect(anchorCorrection(before, after)).toBe(700);
  });
  it('ignores changes below the anchor (section below measured)', () => {
    const l = new SlotLayout(5, { padTop: 40, padBottom: 40, separatorPx: 100 }, 3000);
    const st = l.contentTop(1) + 200;
    const before = { contentTop: l.contentTop(1), innerY: 200, scrollTop: st };
    l.setContentHeight(3, 9000, true);
    expect(anchorCorrection(before, { ...before, contentTop: l.contentTop(1) })).toBe(0);
  });
  it('follows a text anchor that moved inside the current section (image loaded above it)', () => {
    const before = { contentTop: 5000, innerY: 1200, scrollTop: 6100 };
    const after = { contentTop: 5000, innerY: 1500, scrollTop: 6100 };
    expect(anchorCorrection(before, after)).toBe(300);
  });
  it('ignores sub-half-pixel noise', () => {
    expect(anchorCorrection({ contentTop: 0, innerY: 0, scrollTop: 0 }, { contentTop: 0.4, innerY: 0, scrollTop: 0 })).toBe(0);
  });
});

describe('bookProgress / locateProgress', () => {
  const sizes = [100, 300, 0, 600];
  it('weights sections by size', () => {
    expect(bookProgress(sizes, 0, 0)).toBe(0);
    expect(bookProgress(sizes, 1, 0.5)).toBeCloseTo(0.25, 6);
    expect(bookProgress(sizes, 3, 1)).toBe(1);
  });
  it('round-trips through locateProgress', () => {
    for (const [i, f] of [
      [0, 0.5],
      [1, 0.25],
      [3, 0.9],
    ] as const) {
      const p = bookProgress(sizes, i, f);
      const r = locateProgress(sizes, p);
      expect(r.index).toBe(i);
      expect(r.fraction).toBeCloseTo(f, 6);
    }
  });
  it('lands at the end of the last non-empty section for progress 1', () => {
    expect(locateProgress([100, 50, 0], 1)).toEqual({ index: 1, fraction: 1 });
  });
  it('falls back to section count when sizes are unknown', () => {
    expect(bookProgress([0, 0, 0, 0], 2, 0.5)).toBe(0.5);
    expect(locateProgress([0, 0, 0, 0], 0.5).index).toBe(2);
    expect(locateProgress([], 0.5).index).toBe(-1);
  });
});

describe('ScrollVelocity', () => {
  it('measures px/s and resets after a pause', () => {
    const v = new ScrollVelocity(1);
    v.sample(0, 0);
    expect(v.sample(100, 100)).toBeCloseTo(1000, 6);
    expect(v.sample(100, 1000)).toBe(0);
  });
});
