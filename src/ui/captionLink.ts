import type { CaptionRects } from '@contract/types';
import { invoke, isAppError } from '../ipc/commands';
import { createLatestSender } from './captionRects';

/**
 * Serialised window_set_caption_rects sender that also learns whether the native overlay is
 * active: true after a successful non-null report, false after NOT_IMPLEMENTED.
 */
export function createCaptionLink() {
  let native: boolean | undefined;
  const sender = createLatestSender(async (rects: CaptionRects | null) => {
    try {
      await invoke('window_set_caption_rects', { rects });
      if (rects) native = true;
    } catch (e) {
      if (isAppError(e) && e.code === 'NOT_IMPLEMENTED') native = false;
      else console.warn('window_set_caption_rects failed', e);
    }
  });
  return {
    push: (rects: CaptionRects | null) => sender.push(rects),
    /** true = native overlay owns pointer activation; false/undefined = UI handles clicks. */
    isNative: () => native === true,
  };
}
