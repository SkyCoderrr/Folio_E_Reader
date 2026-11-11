import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderFooter } from './ReaderFooter';
import { formatProgress, sectionChapterLabels } from './ReaderFooter.labels';

describe('ReaderFooter', () => {
  it('shows chapter · progress with a time-left slot', () => {
    const html = renderToStaticMarkup(<ReaderFooter chapter="第二十三回" progress={0.314} />);
    expect(html).toContain('第二十三回');
    expect(html).toContain('31.4%');
    expect(html).toContain('data-slot="time-left"');
  });

  it('shows only the percentage when no chapter is known', () => {
    const html = renderToStaticMarkup(<ReaderFooter chapter={null} progress={0} />);
    expect(html).toContain('0.0%');
    expect(html).not.toContain('·');
  });

  it('hides unknown time-left and speed, shows known ones', () => {
    const none = renderToStaticMarkup(
      <ReaderFooter chapter="A" progress={0.5} timeLeftChapter={null} speedLabel={undefined} />,
    );
    expect(none).toContain('data-slot="time-left"></span>');
    const some = renderToStaticMarkup(
      <ReaderFooter
        chapter="A"
        progress={0.5}
        timeLeftChapter="12 min left"
        speedLabel="800 chars/min"
      />,
    );
    expect(some).toContain('12 min left · 800 chars/min');
  });

  it('formats and clamps progress', () => {
    expect(formatProgress(undefined)).toBe('0.0%');
    expect(formatProgress(1.2)).toBe('100.0%');
  });
});

describe('sectionChapterLabels', () => {
  const index: Record<string, number> = {
    'a.xhtml': 1,
    'b.xhtml': 3,
    'b.xhtml#x': 3,
    'c.xhtml': 4,
  };
  const source = {
    sections: Array.from({ length: 6 }, (_, i) => ({ id: String(i) })),
    toc: [
      { label: 'One', href: 'a.xhtml' },
      { label: 'Two', href: 'b.xhtml', subitems: [{ label: 'Two-x', href: 'b.xhtml#x' }] },
      { label: 'Three', href: 'c.xhtml' },
      { label: 'Missing', href: 'zzz.xhtml' },
    ],
    resolveHref: (href: string) =>
      index[href] === undefined ? null : { index: index[href]!, anchor: () => null },
  };

  it('carries the last chapter forward and leaves front matter unlabeled', () => {
    expect(sectionChapterLabels(source as never)).toEqual([
      null,
      'One',
      'One',
      'Two',
      'Three',
      'Three',
    ]);
  });
});
