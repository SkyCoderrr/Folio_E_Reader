import type { BookRecord } from '@contract/types';

const titles: [string, string | null, 'epub' | 'txt'][] = [
  ['三体', '刘慈欣', 'txt'],
  ['红楼梦', '曹雪芹', 'epub'],
  ['Pride and Prejudice', 'Jane Austen', 'epub'],
  ['The Left Hand of Darkness', 'Ursula K. Le Guin', 'epub'],
  ['活着', '余华', 'txt'],
  [
    'A Very Long Title That Should Wrap Over Several Lines In The Card Footer',
    'An Author With A Long Name',
    'epub',
  ],
  ['Moby-Dick; or, The Whale', 'Herman Melville', 'epub'],
  ['围城', '钱钟书', 'txt'],
  ['Dune', 'Frank Herbert', 'epub'],
  ['百年孤独', '加西亚·马尔克斯', 'epub'],
  ['Notes from Underground', 'Fyodor Dostoevsky', 'txt'],
  ['西游记', '吴承恩', 'txt'],
  ['Middlemarch', 'George Eliot', 'epub'],
  ['平凡的世界', '路遥', 'txt'],
  ['Frankenstein', 'Mary Shelley', 'epub'],
  ['The Count of Monte Cristo', 'Alexandre Dumas', 'epub'],
  ['雪国', '川端康成', 'epub'],
  ['Untitled notes', null, 'txt'],
  ['水浒传', '施耐庵', 'txt'],
  ['Ulysses', 'James Joyce', 'epub'],
  ['Meditations', 'Marcus Aurelius', 'epub'],
  ['三国演义', '罗贯中', 'epub'],
  ['Walden', 'Henry David Thoreau', 'epub'],
  ['小王子', '圣埃克苏佩里', 'epub'],
  ['Jane Eyre', 'Charlotte Brontë', 'epub'],
  ['明朝那些事儿', '当年明月', 'txt'],
  ['Great Expectations', 'Charles Dickens', 'epub'],
  ['围炉夜话', null, 'txt'],
  ['The Brothers Karamazov', 'Fyodor Dostoevsky', 'epub'],
  ['边城', '沈从文', 'epub'],
];

const DAY = 86_400_000;

/** Dev-only sample library (#library). Progress and last-read are spread to exercise every state. */
export function sampleBooks(now: number = Date.now()): BookRecord[] {
  return titles.map(([title, author, format], i) => {
    const kind = i % 5; // 0 new, 1 reading, 2 finished, 3 reading, 4 new
    const progress = kind === 2 ? 1 : kind === 1 || kind === 3 ? ((i * 7) % 90) / 100 + 0.04 : 0;
    const opened = kind === 0 || kind === 4 ? null : now - (i % 12) * DAY * 1.7 - i * 60_000;
    return {
      id: `sample-${i}`,
      format,
      title,
      author,
      language: /[\u4e00-\u9fff]/.test(title) ? 'zh-Hans' : 'en',
      fileName: `${title}.${format}`,
      filePath: `C:\\Library\\sample-${i}.${format}`,
      fileSize: 400_000 + i * 31_000,
      fileMissing: i === 17,
      coverPath: null,
      totalChars: null,
      progress,
      addedAt: now - (40 - i) * DAY,
      lastOpenedAt: opened,
      finishedAt: kind === 2 ? (opened ?? now) : null,
    };
  });
}
