import type { BookRecord } from '@contract/types';
import { coverColor } from './libraryModel';
import styles from './LibraryView.module.css';

/** Cover image, or a generated card: saturated colour from the id hash with the title on it. */
export function BookCover({
  book,
  url,
  className,
}: {
  book: BookRecord;
  url: string | null;
  className?: string;
}) {
  return (
    <div className={className} data-testid="cover">
      {url ? (
        <img className={styles.coverImg} src={url} alt="" draggable={false} />
      ) : (
        <div className={styles.generated} style={{ background: coverColor(book.id) }}>
          <span className={styles.generatedText}>{book.title}</span>
        </div>
      )}
    </div>
  );
}
