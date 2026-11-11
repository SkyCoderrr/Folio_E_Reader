import type { TxtPrefsPatch } from '@contract/types';
import { invoke } from '../../ipc/commands';
import { useSettings } from '../../state/settingsStore';
import type { ChapterDetectionValue, ChapterPreview } from './ChapterDetectionDialog';

export const chapterDefaults = { chapterRegex: null, headingMaxChars: null, paragraphMode: null };

/** Drops both queued work and stale responses when edits or dialog ownership change. */
export function chapterPreviewDebouncer(
  bookId: string,
  publish: (preview: ChapterPreview) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let lastValid: Pick<ChapterPreview, 'count' | 'first20'> = {};
  const cancel = () => {
    clearTimeout(timer);
    generation++;
  };
  return {
    cancel,
    edit(value: ChapterDetectionValue) {
      cancel();
      const request = generation;
      publish({ ...lastValid, state: 'loading' });
      timer = setTimeout(() => {
        const defaults = useSettings.getState().settings.txt;
        void invoke('txt_preview_split', {
          bookId,
          chapterRegex: value.chapterRegex ?? defaults.chapterRegex,
          headingMaxChars: value.headingMaxChars ?? defaults.headingMaxChars,
        })
          .then((result) => {
            if (request === generation) {
              lastValid = { count: result.count, first20: result.first20 };
              publish({ state: 'ok', ...lastValid });
            }
          })
          .catch((error: unknown) => {
            if (request === generation)
              publish({ ...lastValid, state: 'error', error: message(error) });
          });
      }, 250);
    },
  };
}
export const message = (error: unknown) =>
  String((error as { message?: string })?.message ?? error);

export async function prepareTxtPreferences(bookId: string, patch: TxtPrefsPatch) {
  const prefs = await invoke('txt_prefs_set', { bookId, patch });
  const manifest = await invoke('txt_prepare', { bookId });
  return { prefs: { ...prefs, detectedEncoding: manifest.detectedEncoding }, manifest };
}
