import { describe, it, expect } from 'vitest';
import { HeightEstimator, MIN_SAMPLE_UNITS, priorPxPerUnit, RATIO_CLAMP, rescaleHeight } from './heightEstimator';

const metrics = { columnWidthPx: 720, fontSizePx: 20, lineHeightPx: 35, unitsPerChar: 1 };

describe('priorPxPerUnit', () => {
  it('is line height divided by characters per line', () => {
    // 720 / (20 × 0.6) = 60 chars per line → 35 / 60 px per char
    expect(priorPxPerUnit(metrics)).toBeCloseTo(35 / 60, 6);
  });
  it('gets taller per unit for a narrower column and bigger font', () => {
    const narrow = priorPxPerUnit({ ...metrics, columnWidthPx: 360 });
    const big = priorPxPerUnit({ ...metrics, fontSizePx: 40, lineHeightPx: 70 });
    expect(narrow).toBeCloseTo(2 * priorPxPerUnit(metrics), 6);
    expect(big).toBeCloseTo(4 * priorPxPerUnit(metrics), 6);
  });
});

describe('HeightEstimator', () => {
  it('uses the prior until something is measured', () => {
    const e = new HeightEstimator(0.5);
    expect(e.pxPerUnit).toBe(0.5);
    expect(e.estimate(10000, 70)).toBe(5000);
    expect(e.estimate(10, 70)).toBe(70); // floor at minPx
  });

  it('learns a size-weighted ratio from measured sections', () => {
    const e = new HeightEstimator(0.5);
    e.observe(0, 10000, 6000);
    e.observe(1, 30000, 15000);
    expect(e.pxPerUnit).toBeCloseTo(21000 / 40000, 6);
    e.observe(1, 30000, 18000); // re-measure replaces the old sample
    expect(e.pxPerUnit).toBeCloseTo(24000 / 40000, 6);
  });

  it('ignores tiny cover/title sections once a real chapter is measured', () => {
    const e = new HeightEstimator(0.5);
    e.observe(0, 300, 900); // full-screen cover image: 3 px/unit, the only sample so far
    expect(e.pxPerUnit).toBeCloseTo(3, 6);
    e.observe(1, MIN_SAMPLE_UNITS * 5, MIN_SAMPLE_UNITS * 5 * 0.6);
    expect(e.pxPerUnit).toBeCloseTo(0.6, 6);
  });

  it('clamps an absurd ratio to prior × RATIO_CLAMP', () => {
    const e = new HeightEstimator(0.5);
    e.observe(0, 5000, 5000 * 100);
    expect(e.pxPerUnit).toBe(0.5 * RATIO_CLAMP);
    e.reset(0.5);
    e.observe(0, 5000, 1);
    expect(e.pxPerUnit).toBe(0.5 / RATIO_CLAMP);
  });

  it('reset forgets samples', () => {
    const e = new HeightEstimator(0.5);
    e.observe(0, 5000, 4000);
    e.reset(0.25);
    expect(e.sampleCount).toBe(0);
    expect(e.pxPerUnit).toBe(0.25);
  });
});

describe('rescaleHeight', () => {
  it('scales a remembered height by the ratio change (font size doubled → about twice as tall)', () => {
    expect(rescaleHeight(3000, 0.5, 1.0, 70)).toBe(6000);
    expect(rescaleHeight(3000, 0.5, 0.25, 70)).toBe(1500);
  });
  it('never goes below minPx and survives a zero ratio', () => {
    expect(rescaleHeight(100, 1, 0.01, 70)).toBe(70);
    expect(rescaleHeight(500, 0, 1, 70)).toBe(500);
  });
});
