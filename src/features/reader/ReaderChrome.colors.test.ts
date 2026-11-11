import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS } from '../../engine/style/readingStyle';
import { CHROME_MIN_CONTRAST, TINT_TEXT_CONTRAST, chromeColors, contrast } from './ReaderChrome.colors';

describe('chromeColors (UI-02)', () => {
  for (const p of BUILTIN_PRESETS) {
    const { background, text } = p.style.colors;
    it(`${p.name}: chrome text >= 4.5:1 and the bar follows the page`, () => {
      const c = chromeColors(background, text)!;
      expect(c).not.toBeNull();
      expect(contrast(c.text1, c.bg)).toBeGreaterThanOrEqual(CHROME_MIN_CONTRAST);
      expect(contrast(c.text2, c.bg)).toBeGreaterThanOrEqual(CHROME_MIN_CONTRAST);
      // The bar stays close to the page colour: a light page never gets a dark bar.
      expect(contrast(c.bg, background)).toBeLessThan(1.25);
      expect(c.dark).toBe(p.id === 'builtin.dark' || p.id === 'builtin.night');
    });
  }

  for (const p of BUILTIN_PRESETS) {
    const { background, text, accent } = p.style.colors;
    it(`${p.name}: accent-tinted state keeps primary text readable (UI-02.2)`, () => {
      const c = chromeColors(background, text, accent)!;
      expect(c.accentTint).not.toBeNull();
      const bar = contrast(c.text1, c.bg);
      // 7:1 wherever the page itself reaches it; Night (low contrast by design) keeps >= 4.5:1.
      const floor = p.id === 'builtin.night' ? CHROME_MIN_CONTRAST : TINT_TEXT_CONTRAST;
      expect(bar).toBeGreaterThanOrEqual(floor);
      expect(contrast(c.text1, c.accentTint!)).toBeGreaterThanOrEqual(floor);
    });
  }

  it('secondary text is quieter than primary text', () => {
    const c = chromeColors('#F3EAD7', '#3A2F23')!;
    expect(c.text2).not.toBe(c.text1);
    expect(contrast(c.text2, c.bg)).toBeLessThan(contrast(c.text1, c.bg));
  });

  it('surface is the background mixed 6% toward the text, same text colour (UI-02.1)', () => {
    const c = chromeColors('#ffffff', '#000000', '#c0392b')!;
    expect(c.bg).toBe('#f0f0f0');
    expect(c.text1).toBe('#000000');
    expect(c.accentTint).not.toBe(c.bg);
  });

  it('returns null for non-hex colours so CSS fallbacks apply', () => {
    expect(chromeColors('rebeccapurple', '#fff')).toBeNull();
  });
});
