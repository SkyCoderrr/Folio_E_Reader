import type { ReactNode } from 'react';
import { formatProgress } from './ReaderFooter.labels';
import styles from './ReaderFooter.module.css';

interface Props {
  /** Current chapter title; falls back to "Section n". */
  chapter?: string | null;
  /** 0..1 over the whole book; undefined while the book is opening. */
  progress?: number;
  /** Right slot: time left in chapter (M8). Empty until then. */
  timeLeft?: ReactNode;
  /** ST-05: preformatted, e.g. "12 min left in chapter"; omitted/null when unknown. */
  timeLeftChapter?: string | null;
  /** ST-05: preformatted, e.g. "3 h 5 min left in book". */
  timeLeftBook?: string | null;
  /** ST-05: preformatted, e.g. "820 chars/min". */
  speedLabel?: string | null;
  /** Transient status, e.g. a layout fallback notice. */
  notice?: ReactNode;
}

/** Reader footer content (PRD 6.7): "Chapter · 31.4%" left, time left right. Caption 12 px. */
export function ReaderFooter({
  chapter,
  progress,
  timeLeft,
  timeLeftChapter,
  timeLeftBook,
  speedLabel,
  notice,
}: Props) {
  return (
    <>
      <span className={styles.position}>
        {progress === undefined ? <span className={styles.chapter}>Opening…</span> : null}
        {progress !== undefined && chapter ? (
          <span className={styles.chapter}>{chapter}</span>
        ) : null}
        {progress !== undefined && chapter ? (
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
        ) : null}
        {progress !== undefined ? (
          <span className={styles.progress}>{formatProgress(progress)}</span>
        ) : null}
      </span>
      {notice ? (
        <span className={styles.notice} role="status">
          {notice}
        </span>
      ) : null}
      <span className={styles.timeLeft} data-slot="time-left">
        {timeLeft}
        {[timeLeftChapter, timeLeftBook, speedLabel].filter(Boolean).join(' · ')}
      </span>
    </>
  );
}
