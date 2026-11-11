import type { BuiltinPresetId, Preset, ReadingStyle } from '@contract/types';

// Keep the settings wire model as the single source of truth.
export type {
  ReadingStyle,
  ReadingStylePatch,
  EpubStyleOverride,
  StyleColors,
  StyleFont,
  StyleText,
  StyleLayout,
  StyleCjk,
} from '@contract/types';

export const DEFAULT_READING_STYLE: ReadingStyle = {
  colors: { background: '#17181B', text: '#D6D1C7', accent: '#D9A55B', selection: '#D9A55B52' },
  font: { latin: 'Sitka Text', cjk: 'Microsoft YaHei', fallback: 'serif', size: 20, weight: 400 },
  text: {
    lineHeight: 1.75,
    letterSpacing: 0,
    paragraphSpacing: 0.5,
    indentMode: 'publisher',
    indentSize: 2,
    align: 'justify',
  },
  layout: { marginX: 48, marginY: 40, maxLineWidthEm: 36, pageGap: 48 },
  cjk: { punctuationTrim: true, autospace: true },
};

export interface BuiltinPreset extends Preset {
  id: BuiltinPresetId;
  builtIn: true;
}

function preset(
  id: BuiltinPresetId,
  name: string,
  background: string,
  text: string,
  accent: string,
): BuiltinPreset {
  const style = structuredClone(DEFAULT_READING_STYLE);
  style.colors = { background, text, accent, selection: `${accent}52` };
  return { id, name, builtIn: true, style, updatedAt: 0 };
}

/** Independent style objects: editing a working copy must not affect another preset. */
export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  preset('builtin.dark', 'Dark', '#17181B', '#D6D1C7', '#D9A55B'),
  preset('builtin.sepia', 'Sepia', '#F3EAD7', '#3A2F23', '#8A4B14'),
  preset('builtin.light', 'Light', '#FAF9F6', '#1E1E1C', '#7A4A0C'),
  preset('builtin.night', 'Night (low contrast)', '#0D0D0E', '#8C867C', '#A07C48'),
];
