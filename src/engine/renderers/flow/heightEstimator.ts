/**
 * Height estimation for unmounted sections (PRD §10.4 step 4):
 * estimate = section.size × px-per-unit, where px-per-unit is learned from the sections measured
 * under the current style and column width (size-weighted), and a prior is used until then.
 * "Unit" = whatever Section.size counts (bytes for EPUB, UTF-16 chars for TXT).
 */

export interface EstimateMetrics {
  columnWidthPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  /** Section.size units per visible character: ~1 for TXT, ~2 for EPUB (markup, UTF-8). */
  unitsPerChar: number;
}

/** Average glyph advance in em, between Latin (~0.5) and CJK (1.0). Only used for the prior. */
export const AVG_CHAR_EM = 0.6;
/** Samples smaller than this are ignored while a larger sample exists (cover/title pages skew the ratio). */
export const MIN_SAMPLE_UNITS = 2000;
/** The learned ratio is clamped to [prior / k, prior × k]. */
export const RATIO_CLAMP = 8;

export function priorPxPerUnit(m: EstimateMetrics): number {
  const charW = Math.max(1, m.fontSizePx * AVG_CHAR_EM);
  const charsPerLine = Math.max(1, m.columnWidthPx / charW);
  const units = Math.max(0.1, m.unitsPerChar);
  return Math.max(1e-6, m.lineHeightPx / (charsPerLine * units));
}

interface Sample {
  units: number;
  heightPx: number;
}

export class HeightEstimator {
  #prior: number;
  #samples = new Map<number, Sample>();

  constructor(prior: number) {
    this.#prior = prior;
  }

  /** Forget all samples (style or column width changed) and set a new prior. */
  reset(prior: number): void {
    this.#prior = prior;
    this.#samples.clear();
  }

  get prior(): number {
    return this.#prior;
  }

  get sampleCount(): number {
    return this.#samples.size;
  }

  /** Record (or replace) the measured height of section `index`. */
  observe(index: number, units: number, heightPx: number): void {
    if (!(units > 0) || !(heightPx >= 0)) return;
    this.#samples.set(index, { units, heightPx });
  }

  forget(index: number): void {
    this.#samples.delete(index);
  }

  /** Learned px per unit, clamped around the prior. */
  get pxPerUnit(): number {
    let bigU = 0;
    let bigH = 0;
    let allU = 0;
    let allH = 0;
    for (const s of this.#samples.values()) {
      allU += s.units;
      allH += s.heightPx;
      if (s.units >= MIN_SAMPLE_UNITS) {
        bigU += s.units;
        bigH += s.heightPx;
      }
    }
    const u = bigU > 0 ? bigU : allU;
    const h = bigU > 0 ? bigH : allH;
    if (!(u > 0)) return this.#prior;
    const ratio = h / u;
    return Math.min(this.#prior * RATIO_CLAMP, Math.max(this.#prior / RATIO_CLAMP, ratio));
  }

  /** Estimated content height of a section of `units` size; never below minPx. */
  estimate(units: number, minPx: number): number {
    return Math.max(Math.round(minPx), Math.round(Math.max(0, units) * this.pxPerUnit));
  }
}

/**
 * A previously measured height after the style/width changed: scale it by the change in the
 * learned ratio, which keeps per-section peculiarities (images, short lines) better than a fresh
 * size-based estimate.
 */
export function rescaleHeight(oldHeightPx: number, oldRatio: number, newRatio: number, minPx: number): number {
  if (!(oldRatio > 0) || !(newRatio > 0)) return Math.max(Math.round(minPx), Math.round(oldHeightPx));
  return Math.max(Math.round(minPx), Math.round((oldHeightPx * newRatio) / oldRatio));
}
