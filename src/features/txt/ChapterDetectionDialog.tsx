import { useEffect, useRef, useState } from 'react';
import type { TxtParagraphMode, TxtPreviewSplitResult } from '@contract/types';
import { Button, Dialog, NumberField, Segmented } from '../../ui/kit';
import styles from './txt.module.css';

export interface ChapterDetectionValue {
  chapterRegex: string | null;
  headingMaxChars: number | null;
  paragraphMode: TxtParagraphMode | null;
}
export interface ChapterDetectionDefaults {
  chapterRegex: string;
  headingMaxChars: number;
  paragraphMode: TxtParagraphMode;
}
export interface ChapterPreview {
  state: 'idle' | 'loading' | 'ok' | 'error';
  count?: number;
  first20?: TxtPreviewSplitResult['first20'];
  error?: string;
}
export interface ChapterDetectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ChapterDetectionValue;
  defaults: ChapterDetectionDefaults;
  preview: ChapterPreview;
  /** Called on every edit; the caller debounces (250 ms). */
  onPreview: (value: ChapterDetectionValue) => void;
  onApply: (value: ChapterDetectionValue) => void;
  onResetToDefaults: () => void;
}

const MODES: { value: TxtParagraphMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'line', label: 'Line' },
  { value: 'blank', label: 'Blank line' },
];

export function ChapterDetectionDialog(props: ChapterDetectionDialogProps) {
  const { open, onOpenChange, value, defaults, preview, onPreview, onApply, onResetToDefaults } =
    props;
  const [regex, setRegex] = useState(value.chapterRegex ?? defaults.chapterRegex);
  const [maxChars, setMaxChars] = useState(value.headingMaxChars ?? defaults.headingMaxChars);
  const [mode, setMode] = useState<TxtParagraphMode>(value.paragraphMode ?? defaults.paragraphMode);
  const [touched, setTouched] = useState(false);
  const wasOpen = useRef(false);

  // Re-seed the draft each time the dialog opens.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setRegex(value.chapterRegex ?? defaults.chapterRegex);
      setMaxChars(value.headingMaxChars ?? defaults.headingMaxChars);
      setMode(value.paragraphMode ?? defaults.paragraphMode);
      setTouched(false);
    }
    wasOpen.current = open;
  }, [open, value, defaults]);

  // null = "use the global setting", so values equal to the default collapse to null.
  const build = (r: string, m: number, p: TxtParagraphMode): ChapterDetectionValue => ({
    chapterRegex: r === defaults.chapterRegex ? null : r,
    headingMaxChars: m === defaults.headingMaxChars ? null : m,
    paragraphMode: p === defaults.paragraphMode ? null : p,
  });

  const edit = (r: string, m: number, p: TxtParagraphMode) => {
    setRegex(r);
    setMaxChars(m);
    setMode(p);
    setTouched(true);
    onPreview(build(r, m, p));
  };

  // Validation happens after the user acts, never on open.
  const showError = touched && preview.state === 'error';
  const canApply = regex.trim() !== '' && !showError && preview.state !== 'loading';
  const atDefaults =
    regex === defaults.chapterRegex &&
    maxChars === defaults.headingMaxChars &&
    mode === defaults.paragraphMode;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Chapter detection"
      description="Headings are lines that match the pattern and are short enough."
      actions={
        <>
          <Button
            variant="ghost"
            disabled={atDefaults}
            onClick={() => {
              setRegex(defaults.chapterRegex);
              setMaxChars(defaults.headingMaxChars);
              setMode(defaults.paragraphMode);
              setTouched(false);
              onResetToDefaults();
            }}
          >
            Reset to Default
          </Button>
          <span className={styles.spacer} />
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canApply}
            onClick={() => onApply(build(regex, maxChars, mode))}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <label className={styles.field}>
          <span>Chapter heading pattern (regex)</span>
          <textarea
            className={styles.regex}
            aria-label="Chapter heading pattern"
            aria-invalid={showError}
            spellCheck={false}
            rows={4}
            value={regex}
            onChange={(e) => edit(e.target.value, maxChars, mode)}
          />
        </label>
        {showError ? (
          <p role="alert" className={styles.error}>
            {preview.error || 'Invalid regular expression.'}
          </p>
        ) : null}

        <div className={styles.twoCol}>
          <div className={styles.field}>
            <span>Heading max characters</span>
            <NumberField
              aria-label="Heading max characters"
              value={maxChars}
              min={4}
              max={100}
              step={1}
              onCommit={(v) => {
                if (v !== null && v !== maxChars) edit(regex, v, mode);
              }}
            />
          </div>
          <div className={styles.field}>
            <span>Paragraphs</span>
            <Segmented
              label="Paragraph mode"
              value={mode}
              options={MODES}
              onChange={(p) => edit(regex, maxChars, p)}
            />
          </div>
        </div>

        <div className={styles.previewHead} aria-live="polite">
          {preview.state === 'loading'
            ? 'Detecting…'
            : preview.count !== undefined
              ? `${preview.count ?? 0} ${preview.count === 1 ? 'chapter' : 'chapters'}`
              : 'Preview'}
        </div>
        <ol className={styles.previewList} aria-label="Detected chapters">
          {preview.first20?.length ? (
            preview.first20.map((h, i) => <li key={i}>{h}</li>)
          ) : preview.count !== undefined ? (
            <li className={styles.muted}>
              No headings found — the book is split into fixed-size parts.
            </li>
          ) : null}
        </ol>
        {(preview.count ?? 0) > (preview.first20?.length ?? 0) ? (
          <div className={styles.muted}>Showing the first {preview.first20?.length}.</div>
        ) : null}
      </div>
    </Dialog>
  );
}
