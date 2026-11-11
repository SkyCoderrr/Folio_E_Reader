import type { ReactNode } from 'react';
import styles from './ReaderChrome.module.css';

/** Top-bar title: book title, then the current chapter in secondary text. */
export function ReaderTitle({ book, chapter }: { book: ReactNode; chapter?: ReactNode }) {
  return (
    <span className={styles.titleText}>
      <span className={styles.titleBook}>{book}</span>
      {chapter ? <span className={styles.titleChapter}>{chapter}</span> : null}
    </span>
  );
}
