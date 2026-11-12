import { useMemo, useState } from 'react';
import type { TocItem } from '../engine/book/BookSource';
import { Toaster, toast } from '../ui/kit';
import { TocSidebar } from '../features/toc/TocSidebar';
import { buildTocSpans, classifyToc, chapterKeyFor } from '../features/toc/tocModel';
import { BookmarkMark } from '../features/toc/BookmarkMark';

const zh: TocItem[] = [
  { label: '序言', href: 'p.xhtml' },
  {
    label: '第一部 少年时代',
    href: 'a.xhtml',
    subitems: [
      { label: '第一章 故乡', href: 'a1.xhtml' },
      {
        label: '第二章 离家',
        href: 'a2.xhtml',
        subitems: [
          { label: '一 渡口', href: 'a2a.xhtml' },
          { label: '二 夜行船', href: 'a2b.xhtml' },
        ],
      },
    ],
  },
  { label: '第二部 远行', href: 'b.xhtml', subitems: [{ label: '第三章 城市', href: 'b1.xhtml' }] },
  { label: '后记', href: 'z.xhtml' },
];
const en: TocItem[] = [
  { label: 'Preface', href: 'p.xhtml' },
  {
    label: 'Part One: The Voyage',
    href: 'a.xhtml',
    subitems: [
      { label: 'Chapter 1. Loomings', href: 'a1.xhtml' },
      {
        label: 'Chapter 2. The Carpet-Bag',
        href: 'a2.xhtml',
        subitems: [
          { label: 'Section i. Arrival', href: 'a2a.xhtml' },
          { label: 'Section ii. The Inn', href: 'a2b.xhtml' },
        ],
      },
    ],
  },
  { label: 'Part Two: The Chase', href: 'b.xhtml', subitems: [{ label: 'Chapter 3. The Whale', href: 'b1.xhtml' }] },
  { label: 'Epilogue', href: 'z.xhtml' },
];

const day = 86_400_000;
const mk = (i: number, label: string, excerpt: string, progress: number, ago: number) => ({
  id: String(i),
  label,
  excerpt,
  progress,
  createdAt: new Date(Date.now() - ago * day).toISOString(),
});
const initial = [
  mk(1, '第一章 故乡', '我从很远的地方回到故乡，正是深冬，天气又阴晦。', 0.08, 0),
  mk(2, 'Chapter 1. Loomings', 'Call me Ishmael. Some years ago, never mind how long precisely.', 0.1, 2),
  mk(3, '第二章 离家', '船在夜里解缆，岸上的灯一盏一盏熄了。', 0.31, 6),
  mk(4, 'Chapter 2. The Carpet-Bag', 'I stuffed a shirt or two into my old carpet-bag, tucked it under my arm.', 0.42, 20),
  mk(5, 'Epilogue', 'The drama is done. Why then here does any one step forth?', 0.99, 90),
];

/** Dev-only TOC sidebar at #toc. Flags: ?en ?empty ?nobm */
export default function TocDemo() {
  const q = location.search;
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
  const [cur, setCur] = useState<string | null>(q.includes('en') ? 'a2b.xhtml' : 'a2a.xhtml');
  const [bms, setBms] = useState(q.includes('nobm') ? [] : initial);
  const toc = useMemo(() => (q.includes('empty') ? [] : q.includes('en') ? en : zh), [q]);
  const hrefs = useMemo(() => {
    const all = (items: TocItem[]): string[] => items.flatMap((i) => [i.href, ...all(i.subitems ?? [])]);
    return all(toc);
  }, [toc]);
  const spans = useMemo(
    () =>
      buildTocSpans(toc, {
        resolve: (h) => (hrefs.includes(h) ? hrefs.indexOf(h) : null),
        weights: hrefs.map(() => 1),
        chapterKey: chapterKeyFor,
      }),
    [toc, hrefs],
  );
  const reading = classifyToc(spans, cur ? { sectionIndex: hrefs.indexOf(cur), progress: 0 } : null);
  return (
    <div style={{ position: 'relative', height: '100vh', background: 'rgb(244 239 228)', color: 'rgb(43 42 39)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ position: 'absolute', insetInlineEnd: 16, top: 16 }}>
        Toggle sidebar
      </button>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px', lineHeight: 1.8, position: 'relative' }}>
        <span style={{ position: 'absolute', insetInlineStart: -8, top: 70 }}>
          <BookmarkMark />
        </span>
        <p>Dummy page over a light reading theme. 这是一个浅色阅读主题下的占位页面。</p>
      </div>
      {/* Demo book: every TOC entry is its own section. */}
      <TocSidebar
        open={open}
        animate
        tab={tab}
        onTabChange={setTab}
        toc={toc}
        spans={spans}
        reading={reading}
        onNavigate={setCur}
        bookmarks={bms}
        onBookmarkOpen={(id) => toast(`Open bookmark ${id}`)}
        onBookmarkDelete={(id) => {
          const gone = bms.find((b) => b.id === id);
          setBms((l) => l.filter((b) => b.id !== id));
          toast('Bookmark deleted', {
            action: {
              label: 'Undo',
              onClick: () => gone && setBms((l) => [...l, gone].sort((a, b) => a.progress - b.progress)),
            },
          });
        }}
      />
      <Toaster />
    </div>
  );
}
