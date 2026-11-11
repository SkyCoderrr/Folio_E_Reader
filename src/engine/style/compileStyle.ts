import defaults from '../../../contract/settings.defaults.json';
import type { EpubStyleOverride, ReadingStyle } from './readingStyle';
import type { CompiledStyle } from './types';

export interface CompileStyleOptions {
  format?: 'epub' | 'txt';
  styleOverride?: EpubStyleOverride;
  /** Overrides for deterministic tests; otherwise use the host's CSS.supports. */
  features?: { punctuationTrim?: boolean; autospace?: boolean; hangingPunctuation?: boolean };
}

const supports = (property: string, value: string) =>
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports(property, value);

// A family is always a CSS string, never a selector or a declaration fragment.
const family = (value: string) =>
  `"${value.replace(/["\\\n\r\f]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `)}"`;

/** Input is the validated effective ReadingStyle from settings (contract/settings.md). */
export function compileStyle(
  style: ReadingStyle,
  options: CompileStyleOptions = {},
): CompiledStyle {
  const { colors, font, text, layout, cjk } = style;
  const level = options.styleOverride ?? defaults.epub.styleOverride;
  const strong = level !== 'minimal' || options.format === 'txt';
  const important = strong ? ' !important' : '';
  const fonts = `${family(font.latin)}, ${family(font.cjk)}, ${font.fallback}`;
  const paragraphs = 'p, div.paragraph';
  const rules = [
    // Revert descendant declarations to UA semantics (headings, em/strong, lists,
    // tables). Exclude roots and media: their sizing belongs to the renderer.
    ...(level === 'full'
      ? [
          'body :where(:not(img, svg, svg *, video, canvas, object, embed)) { all: revert !important; }',
        ]
      : []),
    `html, body {\n  background-color: ${colors.background} !important;\n  color: ${colors.text} !important;\n${strong ? `  font-family: ${fonts}${important};\n  font-size: ${font.size}px${important};\n  font-weight: ${font.weight}${important};\n  line-height: ${text.lineHeight}${important};\n  letter-spacing: ${text.letterSpacing}em${important};\n` : ''}}`,
    // Balanced keeps relative heading sizes, italic/bold emphasis and media structure.
    ...(strong
      ? [
          `body :where(p, div, span, li, dt, dd, blockquote, td, th, h1, h2, h3, h4, h5, h6) {\n  font-family: ${fonts} !important;\n  color: ${colors.text} !important;\n  background-color: transparent !important;\n  line-height: ${text.lineHeight} !important;\n  letter-spacing: ${text.letterSpacing}em !important;\n}`,
          `body :where(p, div, li, dt, dd, blockquote, td, th) { font-size: ${font.size}px !important; }`,
        ]
      : []),
    ...(strong
      ? [
          `${paragraphs} {\n  margin-block-start: 0${important};\n  margin-block-end: ${text.paragraphSpacing}em${important};\n${text.align !== 'publisher' ? `  text-align: ${text.align}${important};\n` : ''}}`,
        ]
      : []),
    ...(text.align === 'justify' ? [`body { hyphens: auto${important}; }`] : []),
    // Colours win in all levels, including text inside links or coloured spans.
    `body * { color: ${colors.text} !important; background-color: transparent !important; }`,
    `body a:any-link, body a:any-link * { color: ${colors.accent} !important; }`,
    `::selection { background-color: ${colors.selection} !important; color: ${colors.text} !important; }`,
    // All descendants, including publisher wrappers and pseudo-elements, stay single column.
    `html, body, body *, body *::before, body *::after {\n  columns: auto !important;\n  column-count: 1 !important;\n  column-width: auto !important;\n  column-span: none !important;\n}`,
    `body :where(:lang(zh), :lang(ja), :lang(ko)), body:where(:lang(zh), :lang(ja), :lang(ko)) {\n  line-break: strict${important};\n  word-break: normal${important};\n  overflow-wrap: anywhere${important};\n  text-justify: inter-character${important};\n}`,
  ];
  const indent =
    text.indentMode === 'publisher' && options.format === 'txt' ? 'force' : text.indentMode;
  if (strong && indent !== 'publisher') {
    rules.push(
      `${paragraphs} { text-indent: ${indent === 'none' ? 0 : text.indentSize}em !important; }`,
    );
    // TXT source normalization (FMT-06/M4.3) owns stripping leading full-width
    // spaces. CSS alone cannot remove U+3000 without changing text offsets.
  }
  if (options.features?.punctuationTrim ?? supports('text-spacing-trim', 'trim-start'))
    rules.push(
      `body :where(:lang(zh), :lang(ja), :lang(ko)), body:where(:lang(zh), :lang(ja), :lang(ko)) { text-spacing-trim: ${cjk.punctuationTrim ? 'trim-start' : 'space-all'}${important}; }`,
    );
  // FMT-09.5: with letter-spacing on, a line-final full-width mark must not carry trailing space.
  // Chromium has no per-glyph control, so hang the mark where hanging-punctuation exists (the
  // spacing then falls outside the line box); engines without it keep text-spacing-trim only.
  if (
    strong &&
    text.letterSpacing > 0 &&
    (options.features?.hangingPunctuation ?? supports('hanging-punctuation', 'allow-end'))
  )
    rules.push(
      `body :where(:lang(zh), :lang(ja), :lang(ko)), body:where(:lang(zh), :lang(ja), :lang(ko)) { hanging-punctuation: allow-end${important}; }`,
    );
  if (options.features?.autospace ?? supports('text-autospace', 'normal'))
    rules.push(
      `body :where(:lang(zh), :lang(ja), :lang(ko)), body:where(:lang(zh), :lang(ja), :lang(ko)) { text-autospace: ${cjk.autospace ? 'normal' : 'no-autospace'}${important}; }`,
    );
  return {
    css: rules.join('\n\n') + '\n',
    fontSizePx: font.size,
    lineHeightPx: font.size * text.lineHeight,
    maxLineWidthPx: layout.maxLineWidthEm === 0 ? null : layout.maxLineWidthEm * font.size,
    marginXPx: layout.marginX,
    marginYPx: layout.marginY,
    pageGapPx: layout.pageGap,
    background: colors.background,
    foreground: colors.text,
  };
}
