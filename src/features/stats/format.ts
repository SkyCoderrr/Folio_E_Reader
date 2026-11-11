/** Presentational formatters for stats (view-model only; no IPC). */
export function formatMinutes(ms: number): string {
  if (ms > 0 && ms < 60000) return '< 1 min';
  const min = Math.round(Math.max(0, ms) / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** ST-04: CJK books read in chars/min, Latin books in words/min (Latin chars / 5.5). */
export const CHARS_PER_WORD = 5.5;
export const MIN_SPEED_MS = 5 * 60000;
export type SpeedUnit = 'chars' | 'words';
export function speedUnit(language: string | null | undefined): SpeedUnit {
  return !language || /^(zh|ja|ko)(-|$)/i.test(language) ? 'chars' : 'words';
}
export function formatSpeed(charsPerMin: number | null, language?: string | null): string {
  if (charsPerMin === null || !Number.isFinite(charsPerMin) || charsPerMin <= 0) return '—';
  const words = speedUnit(language) === 'words';
  const v = words ? charsPerMin / CHARS_PER_WORD : charsPerMin;
  return `${Math.round(v).toLocaleString('en-US')} ${words ? 'words' : 'chars'}/min`;
}

/** ST-05: remaining reading time, null until 5 active minutes of data. */
export function timeLeftMs(b: {
  activeMs: number;
  chars: number;
  progress: number;
  totalChars: number | null;
}): number | null {
  if (b.activeMs < MIN_SPEED_MS || b.chars <= 0 || !b.totalChars) return null;
  const rate = b.chars / b.activeMs;
  return Math.max(0, (b.totalChars * (1 - Math.min(1, b.progress))) / rate);
}
export function formatTimeLeft(ms: number | null): string {
  return ms === null ? '—' : formatMinutes(ms);
}

export function formatPercent(progress: number): string {
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
}

export function formatDay(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

/** 'YYYY-MM-DD' -> locale short month + day, e.g. "Oct 12". */
export function formatAxisDay(day: string | undefined, locale?: string): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
