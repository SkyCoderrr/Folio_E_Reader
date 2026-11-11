import { useEffect, useRef } from 'react';
import { TitleBar } from '../../ui/TitleBar';
import styles from './StartScreen.module.css';

interface Props {
  onOpenFile: (file: File) => void;
  onClose: () => void;
  error?: string;
}

/** Empty state shown before a book is open (Demo 1 shell; the Library replaces it in M3). */
export function StartScreen({ onOpenFile, onClose, error }: Props) {
  const input = useRef<HTMLInputElement>(null);

  // Ctrl+O is the documented import shortcut (keymap: library.import).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        input.current?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={styles.screen}>
      <TitleBar title="Folio" onClose={onClose} />
      <main className={styles.content}>
        <section className={styles.panel} aria-labelledby="start-title">
          <h1 id="start-title" className={styles.headline}>
            Open a book to begin
          </h1>
          <p className={styles.body}>Choose an EPUB file to start reading.</p>
          <button type="button" className={styles.primary} onClick={() => input.current?.click()}>
            Open Book
            <kbd className={styles.kbd}>Ctrl+O</kbd>
          </button>
          <input
            ref={input}
            className={styles.file}
            type="file"
            accept=".epub"
            aria-label="Open Book file"
            tabIndex={-1}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) onOpenFile(selected);
              e.target.value = '';
            }}
          />
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
