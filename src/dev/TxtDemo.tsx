import { useState } from 'react';
import type { TxtEncoding } from '@contract/types';
import { Button, Toaster } from '../ui/kit';
import { EncodingMenuItems } from '../features/txt/EncodingMenuItems';
import {
  ChapterDetectionDialog,
  type ChapterDetectionValue,
  type ChapterPreview,
} from '../features/txt/ChapterDetectionDialog';

const DEFAULT_RE = '^[ \\t　]*(?:第[0-9０-９零〇一二三四五六七八九十百千万两]+[章回节節卷集部篇].*)$';
const HEADINGS = Array.from(
  { length: 20 },
  (_, i) => `第${i + 1}章 ${['初遇', '风起', '夜雨', '旧事'][i % 4]}`,
);
const NONE: ChapterDetectionValue = { chapterRegex: null, headingMaxChars: null, paragraphMode: null };
const OK: ChapterPreview = { state: 'ok', count: 128, first20: HEADINGS };

/** Dev-only TXT controls at #txt. */
export default function TxtDemo() {
  const [enc, setEnc] = useState<TxtEncoding>('auto');
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<ChapterDetectionValue>(NONE);
  const [preview, setPreview] = useState<ChapterPreview>(OK);
  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div
        role="menu"
        aria-label="Text Encoding"
        style={{ width: 240, border: '1px solid var(--border-strong)', borderRadius: 8, padding: 4 }}
      >
        <EncodingMenuItems current={enc} detected="gb18030" onPick={setEnc} />
      </div>
      <Button onClick={() => setOpen(true)}>Chapter detection…</Button>
      <ChapterDetectionDialog
        open={open}
        onOpenChange={setOpen}
        value={val}
        defaults={{ chapterRegex: DEFAULT_RE, headingMaxChars: 40, paragraphMode: 'auto' }}
        preview={preview}
        onPreview={(v) => {
          try {
            new RegExp(v.chapterRegex ?? DEFAULT_RE);
            setPreview(OK);
          } catch (e) {
            setPreview({ state: 'error', error: String(e) });
          }
        }}
        onApply={(v) => {
          setVal(v);
          setOpen(false);
        }}
        onResetToDefaults={() => {
          setVal(NONE);
          setPreview(OK);
        }}
      />
      <Toaster />
    </div>
  );
}
