import { IconButton } from '../../ui/IconButton';
import { ArrowLeftIcon } from '../../ui/icons';
import { TitleBar } from '../../ui/TitleBar';
import {
  formatAxisDay,
  formatDay,
  formatMinutes,
  formatPercent,
  formatSpeed,
  formatTimeLeft,
} from './format';
import styles from './StatsPage.module.css';

/** View-model types (contract StatsDay/StatsBook are still draft; Codex maps into these). */
export interface StatsDayVM {
  day: string; // local 'YYYY-MM-DD'
  activeMs: number;
  chars: number;
}
export interface StatsBookVM {
  bookId: string;
  title: string;
  activeMs: number;
  progress: number; // 0..1
  lastReadAt: string | null;
  /** Null until 5 active minutes (ST-05). */
  charsPerMin: number | null;
  language?: string | null;
  timeLeftMs?: number | null;
}
export interface StatsPageProps {
  /** Up to 30 consecutive days, oldest first; the last entry is today. */
  days: StatsDayVM[];
  books: StatsBookVM[];
  /** Books at progress >= 1. Derived from `books` when omitted. */
  booksFinished?: number;
  onBack: () => void;
  onOpenBook: (bookId: string) => void;
  /** BCP 47 tag for dates (default: the system locale). Tests pass 'en'. */
  locale?: string;
}

/** Time-weighted mean of the books that qualify for a speed; null when none do. */
function avgSpeed(books: StatsBookVM[]): number | null {
  const q = books.filter((b) => b.charsPerMin !== null && b.activeMs > 0);
  const ms = q.reduce((a, b) => a + b.activeMs, 0);
  return ms > 0 ? q.reduce((a, b) => a + b.charsPerMin! * b.activeMs, 0) / ms : null;
}

export function statsTotals(days: StatsDayVM[], books: StatsBookVM[]) {
  const sum = (d: StatsDayVM[]) => d.reduce((a, x) => a + x.activeMs, 0);
  const ms = sum(days);
  const dominant = [...books]
    .filter((b) => b.charsPerMin !== null)
    .sort((a, b) => b.activeMs - a.activeMs)[0];
  return {
    today: days.length ? days[days.length - 1]!.activeMs : 0,
    week: sum(days.slice(-7)),
    month: sum(days.slice(-30)),
    all: books.reduce((a, b) => a + b.activeMs, 0) || ms,
    finished: books.filter((b) => b.progress >= 1).length,
    charsPerMin: avgSpeed(books),
    avgLanguage: dominant?.language ?? null,
  };
}

export function StatsPage({
  days,
  books,
  booksFinished,
  onBack,
  onOpenBook,
  locale,
}: StatsPageProps) {
  const t = statsTotals(days, books);
  const empty = t.all === 0 && books.length === 0;
  const max = Math.max(1, ...days.map((d) => d.activeMs));
  const tiles: [string, string][] = [
    ['Today', formatMinutes(t.today)],
    ['This week', formatMinutes(t.week)],
    ['This month', formatMinutes(t.month)],
    ['All time', formatMinutes(t.all)],
  ];
  if (t.charsPerMin !== null)
    tiles.push(['Average speed', formatSpeed(t.charsPerMin, t.avgLanguage)]);
  void booksFinished;
  return (
    <div className={styles.screen}>
      <TitleBar
        title={<h1 className={styles.titleBarText}>Reading stats</h1>}
        leading={
          <IconButton label="Back to Library" align="start" onClick={onBack}>
            <ArrowLeftIcon />
          </IconButton>
        }
      />
      <main className={styles.page}>
        {empty ? (
          <div className={styles.empty} data-slot="stats-empty">
            <p className={styles.emptyTitle}>No reading time yet</p>
            <p className={styles.emptyHint}>
              Open a book and read for a while. Your time shows up here.
            </p>
          </div>
        ) : (
          <>
            <section className={styles.tiles} aria-label="Totals">
              {tiles.map(([label, value]) => (
                <div key={label} className={styles.tile}>
                  <span className={styles.tileValue}>{value}</span>
                  <span className={styles.tileLabel}>{label}</span>
                </div>
              ))}
            </section>
            <section aria-label="Minutes read, last 30 days">
              <h2 className={styles.h2}>Last 30 days</h2>
              <div className={styles.chart} role="img" aria-label="Minutes read per day">
                {days.map((d, i) => (
                  <div
                    key={d.day}
                    className={styles.col}
                    data-slot="bar"
                    title={`${d.day}: ${formatMinutes(d.activeMs)}`}
                  >
                    <div
                      className={i === days.length - 1 ? styles.barToday : styles.bar}
                      style={{ height: `${(d.activeMs / max) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className={styles.axis}>
                <span>{formatAxisDay(days[0]?.day, locale)}</span>
                <span>Today</span>
              </div>
            </section>
            <section aria-label="Books">
              <h2 className={styles.h2}>Books</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Time read</th>
                    <th>Progress</th>
                    <th>Last read</th>
                    <th>Speed</th>
                    <th>Time left</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map((b) => (
                    <tr
                      key={b.bookId}
                      className={b.progress >= 1 ? styles.done : undefined}
                      onClick={() => onOpenBook(b.bookId)}
                    >
                      <td>
                        <button
                          type="button"
                          className={styles.link}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenBook(b.bookId);
                          }}
                        >
                          {b.title}
                        </button>
                      </td>
                      <td>{formatMinutes(b.activeMs)}</td>
                      <td>{formatPercent(b.progress)}</td>
                      <td>{formatDay(b.lastReadAt)}</td>
                      <td>{formatSpeed(b.charsPerMin, b.language)}</td>
                      <td>{formatTimeLeft(b.timeLeftMs ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
