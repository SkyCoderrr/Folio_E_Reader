import { useState } from 'react';
import type { LibrarySort } from '@contract/types';
import { Toaster, toast } from '../ui/kit';
import { DropOverlay } from '../features/library/DropOverlay';
import { LibraryView } from '../features/library/LibraryView';
import type { FormatFilter, ProgressFilter, SortDir } from '../features/library/libraryModel';
import { sampleBooks } from './sampleBooks';

const noCover = () => null;

/** Dev-only Library screen with sample data at #library. Flags: ?empty ?import ?drop */
export default function LibraryDemo() {
  const [books, setBooks] = useState(() =>
    location.search.includes('empty') ? [] : sampleBooks(),
  );
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<LibrarySort>('lastRead');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState<ProgressFilter>('all');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  return (
    <>
      <LibraryView
        books={books}
        view={view}
        sort={sort}
        sortDir={sortDir}
        filter={filter}
        formatFilter={formatFilter}
        query={query}
        selection={selection}
        importing={location.search.includes('import') ? { done: 3, total: 12 } : null}
        coverUrl={noCover}
        onViewChange={setView}
        onSortChange={(s, d) => {
          setSort(s);
          setSortDir(d);
        }}
        onFilterChange={setFilter}
        onFormatFilterChange={setFormatFilter}
        onQueryChange={setQuery}
        onSelectionChange={setSelection}
        onOpen={(id) => toast(`Open ${id}`)}
        onRemove={(ids) => {
          setBooks((b) => b.filter((x) => !ids.includes(x.id)));
          setSelection([]);
        }}
        onAddBooks={() => toast('Add Books')}
        onEncoding={(id) => toast(`Encoding ${id}`)}
        onChapterDetection={(id) => toast(`Chapters ${id}`)}
      />
      <DropOverlay visible={location.search.includes('drop')} />
      <Toaster />
    </>
  );
}
