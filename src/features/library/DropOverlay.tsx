import styles from './LibraryView.module.css';

/** Full-window drop target hint. Never intercepts pointer events (the OS drop is handled in Rust). */
export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <div className={styles.drop} data-visible={visible} aria-hidden={!visible} role="presentation">
      <div className={styles.dropBox}>Drop books to add them</div>
    </div>
  );
}
