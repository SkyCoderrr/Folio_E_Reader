import { useEffect, useRef, useState } from 'react';
import type { TxtBookPrefs, TxtPrefsPatch } from '@contract/types';
import { invoke } from '../../ipc/commands';
import { useSettings } from '../../state/settingsStore';
import { Dialog } from '../../ui/kit';
import {
  chapterDefaults,
  chapterPreviewDebouncer,
  prepareTxtPreferences,
  message,
} from './txtSettings';
import { EncodingMenuItems } from './EncodingMenuItems';
import { ChapterDetectionDialog, type ChapterPreview } from './ChapterDetectionDialog';

export type TxtSettingsTarget = { bookId: string; mode: 'encoding' | 'chapters' };
export function TxtSettingsDialogs({
  target,
  onClose,
  onApply,
}: {
  target: TxtSettingsTarget;
  onClose(): void;
  onApply?(patch: TxtPrefsPatch): Promise<void>;
}) {
  const [prefs, setPrefs] = useState<TxtBookPrefs>();
  const [preview, setPreview] = useState<ChapterPreview>({ state: 'idle' });
  const [error, setError] = useState('');
  const busy = useRef(false);
  const defaults = useSettings((state) => state.settings.txt);
  const debouncer = useRef<ReturnType<typeof chapterPreviewDebouncer> | null>(null);
  useEffect(() => {
    let disposed = false;
    const debounce = chapterPreviewDebouncer(target.bookId, setPreview);
    debouncer.current = debounce;
    void invoke('book_open', { bookId: target.bookId })
      .then((result) => {
        if (!disposed && result.txtPrefs) setPrefs(result.txtPrefs);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(message(reason));
      });
    return () => {
      disposed = true;
      debounce.cancel();
    };
  }, [target.bookId]);
  const apply = (patch: TxtPrefsPatch) => {
    if (busy.current) return;
    busy.current = true;
    debouncer.current?.cancel();
    void (onApply ? onApply(patch) : prepareTxtPreferences(target.bookId, patch))
      .then(onClose)
      .catch((reason: unknown) => setError(message(reason)))
      .finally(() => {
        busy.current = false;
      });
  };
  return (
    <>
      {target.mode === 'encoding' ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          title="Text Encoding"
          actions={null}
        >
          {prefs && (
            <div role="menu" aria-label="Text Encoding">
              <EncodingMenuItems
                current={prefs.encoding}
                detected={prefs.detectedEncoding}
                onPick={(encoding) => apply({ encoding })}
              />
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </Dialog>
      ) : prefs ? (
        <ChapterDetectionDialog
          open
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          value={prefs}
          defaults={defaults}
          preview={error ? { state: 'error', error } : preview}
          onPreview={(value) => {
            setError('');
            debouncer.current?.edit(value);
          }}
          onApply={apply}
          onResetToDefaults={() => apply(chapterDefaults)}
        />
      ) : (
        <Dialog
          open
          title="Chapter detection"
          actions={null}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <p role={error ? 'alert' : 'status'}>{error || 'Loading…'}</p>
        </Dialog>
      )}
    </>
  );
}
