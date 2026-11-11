/**
 * Theme-derived reader chrome colours (PRD 6.5 / UI-02): the top bar, footer and sidebar adopt
 * the reading theme, so a light page never sits under a black bar.
 *  - bg:     page background mixed slightly toward the text colour (a solid, theme-tinted bar)
 *  - text1:  the reading text colour
 *  - text2:  text mixed toward the background, as far as 4.5:1 contrast on bg still allows
 *  - border: hairline at low text alpha
 */
export interface ChromeColors {
  bg: string;
  text1: string;
  text2: string;
  border: string;
  /** Solid accent tint for the current TOC row / selected states; null without an accent. */
  accentTint: string | null;
  /** True when the page is dark (drives desk/edge tints and native control colours). */
  dark: boolean;
}

type Rgb = [number, number, number];

/** Minimum contrast for chrome text on the chrome background (WCAG AA body text). */
export const CHROME_MIN_CONTRAST = 4.5;
const BG_LIFT = 0.06;
const TEXT2_FADE_MAX = 0.4;
const TINT_MAX = 0.18;
/** UI-02.2: primary text on a tinted state. */
export const TINT_TEXT_CONTRAST = 7;

export function parseHex(input: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** a mixed toward b by t (0..1), in sRGB like CSS color-mix(in srgb). */
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => v + (b[i]! - v) * t) as Rgb;

export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 0;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Null when either colour is not a hex value (the CSS fallbacks in ReaderChrome.module.css apply). */
export function chromeColors(
  background: string,
  text: string,
  accent?: string,
): ChromeColors | null {
  const bg = parseHex(background);
  const fg = parseHex(text);
  if (!bg || !fg) return null;
  const acc = accent ? parseHex(accent) : null;
  const textHex = toHex(fg);
  // Lift the bar toward the text colour, unless that would cost the text its contrast.
  let barRgb = mix(bg, fg, BG_LIFT);
  if (contrast(toHex(barRgb), textHex) < CHROME_MIN_CONTRAST) barRgb = bg;
  const bar = toHex(barRgb);
  // Secondary text: fade toward the page as far as the contrast floor allows.
  let text2 = textHex;
  for (let t = TEXT2_FADE_MAX; t > 0; t -= 0.02) {
    const candidate = toHex(mix(fg, bg, t));
    if (contrast(candidate, bar) >= CHROME_MIN_CONTRAST) {
      text2 = candidate;
      break;
    }
  }
  // Accent tint on the bar: start at TINT_MAX and back off until text1 keeps its own contrast
  // (>= 7:1 where the bar itself allows it, else the bar's own value, never below 4.5:1).
  let accentTint: string | null = null;
  if (acc) {
    const floor = Math.min(TINT_TEXT_CONTRAST, contrast(textHex, bar));
    accentTint = bar;
    for (let t = TINT_MAX; t > 0; t -= 0.01) {
      const candidate = toHex(mix(parseHex(bar)!, acc, t));
      if (contrast(textHex, candidate) >= floor) {
        accentTint = candidate;
        break;
      }
    }
  }
  const [r, g, b] = fg.map(Math.round) as Rgb;
  return {
    accentTint,
    bg: bar,
    text1: textHex,
    text2,
    border: `rgb(${r} ${g} ${b} / 0.14)`,
    dark: luminance(bg) < luminance(fg),
  };
}
