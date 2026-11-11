import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatsPage } from './StatsPage';
import { formatMinutes, formatSpeed, timeLeftMs } from './format';
import { AutoScrollPill } from '../autoscroll/AutoScrollPill';

const noop = () => {};
const colors = { bg: 'rgb(1 1 1)', text1: 'rgb(2 2 2)', text2: 'rgb(3 3 3)', border: 'rgb(4 4 4)' };

describe('StatsPage', () => {
  it('renders bars, totals and the book table', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, '0')}`,
      activeMs: i === 29 ? 1_800_000 : 600_000,
      chars: 1000,
    }));
    const html = renderToStaticMarkup(
      <StatsPage
        days={days}
        books={[
          {
            bookId: 'a',
            title: 'Moby',
            activeMs: 9_000_000,
            progress: 1,
            lastReadAt: '2026-10-30',
            charsPerMin: 900,
          },
        ]}
        onBack={noop}
        onOpenBook={noop}
        locale="en"
      />,
    );
    expect(html.match(/data-slot="bar"/g)).toHaveLength(30);
    expect(html).toContain('30 min'); // today
    expect(html).toContain('Moby');
    expect(html).toContain('100%');
    expect(html).toContain('This month');
    expect(html).toContain('Reading stats');
    expect(html).not.toContain('Folio');
    expect(html).toContain('Oct 1'); // axis start
    expect(html).toContain('Today');
    expect(html).toContain('900 chars/min');
  });

  it('shows the empty state without data', () => {
    const html = renderToStaticMarkup(
      <StatsPage days={[]} books={[]} onBack={noop} onOpenBook={noop} />,
    );
    expect(html).toContain('data-slot="stats-empty"');
    expect(html).not.toContain('data-slot="bar"');
  });
});

describe('AutoScrollPill', () => {
  it('shows speed when running and Paused when paused', () => {
    const run = renderToStaticMarkup(
      <AutoScrollPill active paused={false} speedLabel="120%" colors={colors} />,
    );
    expect(run).toContain('120%');
    expect(run).toContain('data-paused="false"');
    const paused = renderToStaticMarkup(
      <AutoScrollPill active paused speedLabel="120%" colors={colors} />,
    );
    expect(paused).toContain('Paused');
    expect(paused).not.toContain('>120%<');
  });

  it('formats sub-minute durations, word speeds, time left and hides the unqualified average', () => {
    expect(formatMinutes(20_000)).toBe('< 1 min');
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatSpeed(1100, 'en')).toBe('200 words/min');
    expect(formatSpeed(1100, 'zh-Hans')).toBe('1,100 chars/min');
    expect(
      timeLeftMs({ activeMs: 240_000, chars: 1000, progress: 0.5, totalChars: 10_000 }),
    ).toBeNull();
    expect(timeLeftMs({ activeMs: 600_000, chars: 6000, progress: 0.5, totalChars: 12_000 })).toBe(
      600_000,
    );
    const days = [{ day: '2026-10-30', activeMs: 20_000, chars: 500 }];
    const html = renderToStaticMarkup(
      <StatsPage
        days={days}
        books={[
          {
            bookId: 'a',
            title: 'Alice',
            activeMs: 20_000,
            progress: 0.1,
            lastReadAt: null,
            charsPerMin: null,
          },
        ]}
        onBack={noop}
        onOpenBook={noop}
      />,
    );
    expect(html).toContain('&lt; 1 min');
    expect(html).not.toContain('Average speed');
  });
});
