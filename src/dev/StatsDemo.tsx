import { useState } from 'react';
import { StatsPage, type StatsBookVM, type StatsDayVM } from '../features/stats/StatsPage';
import { AutoScrollPill } from '../features/autoscroll/AutoScrollPill';
import { chromeColors } from '../features/reader/ReaderChrome.colors';

const days: StatsDayVM[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2026, 9, 12 + i);
  const ms = ((i * 37) % 11) * 6 * 60000;
  return {
    day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    activeMs: ms,
    chars: (ms / 60000) * 700,
  };
});
const books: StatsBookVM[] = [
  {
    bookId: '1',
    title: '红楼梦',
    activeMs: 9_000_000,
    progress: 0.31,
    lastReadAt: '2026-11-09',
    charsPerMin: 760,
  },
  {
    bookId: '2',
    title: 'Moby-Dick',
    activeMs: 14_400_000,
    progress: 1,
    lastReadAt: '2026-11-02',
    charsPerMin: 1180,
  },
  {
    bookId: '3',
    title: 'Untouched',
    activeMs: 0,
    progress: 0,
    lastReadAt: null,
    charsPerMin: null,
  },
];

export default function StatsDemo() {
  const [paused, setPaused] = useState(false);
  if (location.hash === '#autoscroll') {
    const page = `#${'f6f1e7'}`; // built at runtime: no hex literal outside tokens.css
    const colors = chromeColors(page, `#${'2b2620'}`)!;
    return (
      <div style={{ position: 'relative', height: '100vh', background: page }}>
        <button type="button" onClick={() => setPaused((p) => !p)}>
          toggle pause
        </button>
        <AutoScrollPill active paused={paused} speedLabel="120%" colors={colors} />
      </div>
    );
  }
  return <StatsPage days={days} books={books} onBack={() => {}} onOpenBook={() => {}} />;
}
