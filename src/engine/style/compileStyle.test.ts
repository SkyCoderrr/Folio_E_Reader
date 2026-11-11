import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PRESETS, DEFAULT_READING_STYLE } from './readingStyle';
import { compileStyle } from './compileStyle';
import schema from '../../../contract/settings.schema.json';

afterEach(() => vi.unstubAllGlobals());

describe.each(BUILTIN_PRESETS)('$id', (preset) => {
  it.each(['minimal', 'balanced', 'full'] as const)('snapshots %s override', (styleOverride) => {
    expect(
      compileStyle(preset.style, {
        styleOverride,
        features: { punctuationTrim: true, autospace: true },
      }),
    ).toMatchSnapshot();
  });
});

// WCAG relative luminance, computed from the exact PRD hex colours, not rounded prose.
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

it('asserts WCAG contrast values for every preset', () => {
  const ratios = BUILTIN_PRESETS.map(({ id, style: { colors } }) => {
    const text = contrast(colors.background, colors.text);
    const accent = contrast(colors.background, colors.accent);
    expect(text).toBeGreaterThanOrEqual(id === 'builtin.night' ? 4.5 : 7);
    expect(accent).toBeGreaterThanOrEqual(4.5);
    return { id, text: Number(text.toFixed(3)), accent: Number(accent.toFixed(3)) };
  });
  expect(ratios).toMatchSnapshot();
});

it('matches contract schema defaults and independent built-in objects', () => {
  const groups = schema.$defs.ReadingStyle.properties;
  for (const group of ['colors', 'font', 'text', 'layout', 'cjk'] as const) {
    const definition = groups[group];
    for (const [key, property] of Object.entries(definition.properties)) {
      if ('default' in property)
        expect(
          DEFAULT_READING_STYLE[group][key as keyof (typeof DEFAULT_READING_STYLE)[typeof group]],
        ).toEqual(property.default);
    }
  }
  expect(BUILTIN_PRESETS.map((preset) => preset.id)).toEqual([
    'builtin.dark',
    'builtin.sepia',
    'builtin.light',
    'builtin.night',
  ]);
  expect(BUILTIN_PRESETS[0].style).toEqual(DEFAULT_READING_STYLE);
  expect(BUILTIN_PRESETS[0].style.font).not.toBe(BUILTIN_PRESETS[1].style.font);
});

it('returns geometry for the renderer without root geometry CSS', () => {
  const compiled = compileStyle(DEFAULT_READING_STYLE);
  expect(compiled).toMatchObject({
    fontSizePx: 20,
    lineHeightPx: 35,
    maxLineWidthPx: 720,
    marginXPx: 48,
    marginYPx: 40,
    pageGapPx: 48,
  });
  const root = compiled.css.slice(0, compiled.css.indexOf('}'));
  expect(root).not.toMatch(/(?:^|[;\n])\s*(?:width|max-width|height|padding|margin)[\s:-]/);
  const style = structuredClone(DEFAULT_READING_STYLE);
  style.layout.maxLineWidthEm = 0;
  style.layout.pageGap = 72;
  expect(compileStyle(style).pageGapPx).toBe(72);
  expect(compileStyle(style).maxLineWidthPx).toBeNull();
  expect(compiled.css).toContain('column-count: 1 !important');
});

it('defaults to balanced, preserving emphasis and heading sizes', () => {
  const css = compileStyle(DEFAULT_READING_STYLE).css;
  expect(css).toBe(compileStyle(DEFAULT_READING_STYLE, { styleOverride: 'balanced' }).css);
  expect(css).not.toContain('font-style: normal');
  expect(css).not.toContain('all: revert');
  expect(compileStyle(DEFAULT_READING_STYLE, { styleOverride: 'full' }).css).toContain(
    'all: revert !important',
  );
  expect(compileStyle(DEFAULT_READING_STYLE, { styleOverride: 'minimal' }).css).not.toMatch(
    /font-family:|font-size:|font-weight:|line-height:|letter-spacing:|margin-block|text-align:|text-indent:/,
  );
});

it('feature-detects CJK enhancements and honours disabled options', () => {
  vi.stubGlobal('CSS', { supports: vi.fn().mockReturnValue(false) });
  expect(compileStyle(DEFAULT_READING_STYLE).css).not.toMatch(/text-spacing-trim|text-autospace/);
  vi.stubGlobal('CSS', { supports: vi.fn().mockReturnValue(true) });
  expect(compileStyle(DEFAULT_READING_STYLE).css).toContain('text-spacing-trim: trim-start');
  const style = structuredClone(DEFAULT_READING_STYLE);
  style.cjk = { punctuationTrim: false, autospace: false };
  expect(compileStyle(style).css).toContain('text-spacing-trim: space-all');
  expect(compileStyle(style).css).toContain('text-autospace: no-autospace');
  expect(
    compileStyle(style, { features: { punctuationTrim: false, autospace: false } }).css,
  ).not.toMatch(/text-spacing-trim|text-autospace/);
});

it('hangs line-end CJK punctuation only with letter-spacing and feature support (FMT-09.5)', () => {
  const style = structuredClone(DEFAULT_READING_STYLE);
  style.text.letterSpacing = 0.05;
  const on = compileStyle(style, { features: { hangingPunctuation: true } }).css;
  expect(on).toContain('hanging-punctuation: allow-end');
  expect(compileStyle(style, { features: { hangingPunctuation: false } }).css).not.toContain(
    'hanging-punctuation',
  );
  style.text.letterSpacing = 0;
  expect(compileStyle(style, { features: { hangingPunctuation: true } }).css).not.toContain(
    'hanging-punctuation',
  );
});

it('keeps strict CJK line breaking for TXT across publisher override levels', () => {
  for (const styleOverride of ['minimal', 'balanced', 'full'] as const) {
    const css = compileStyle(DEFAULT_READING_STYLE, { format: 'txt', styleOverride }).css;
    expect(css).toContain('line-break: strict !important');
    expect(css).toContain('word-break: normal !important');
    expect(css).toContain('text-indent: 2em !important');
  }
});

it('handles publisher, force, none and TXT indentation and publisher alignment', () => {
  expect(compileStyle(DEFAULT_READING_STYLE).css).not.toContain('text-indent:');
  expect(compileStyle(DEFAULT_READING_STYLE, { format: 'txt' }).css).toContain(
    'text-indent: 2em !important',
  );
  const style = structuredClone(DEFAULT_READING_STYLE);
  style.text.indentMode = 'force';
  style.text.align = 'left';
  expect(compileStyle(style).css).toContain('text-indent: 2em !important');
  expect(compileStyle(style).css).toContain('text-align: left !important');
  style.text.indentMode = 'none';
  style.text.align = 'publisher';
  expect(compileStyle(style).css).toContain('text-indent: 0em !important');
  expect(compileStyle(style).css).not.toContain('text-align:');
});

it('quotes installed font families safely', () => {
  const style = structuredClone(DEFAULT_READING_STYLE);
  style.font.latin = 'A"; color:red; }\n';
  expect(compileStyle(style).css).toContain('"A\\22 ; color:red; }\\a "');
});
