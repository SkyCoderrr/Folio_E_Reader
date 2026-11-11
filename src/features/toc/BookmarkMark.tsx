import styles from './toc.module.css';

/** Small margin mark for a bookmarked line (renderer overlay positions it). */
export function BookmarkMark({ onClick, label = 'Remove bookmark' }: { onClick?: () => void; label?: string }) {
  return (
    <button type="button" className={styles.mark} aria-label={label} title={label} onClick={onClick}>
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
        <path d="M0 0h10v16L5 12 0 16z" fill="currentColor" />
      </svg>
    </button>
  );
}
