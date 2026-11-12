import { errorCopy } from '../ipc/errorCopy';
import { useEffect, useState } from 'react';
import { StatsPage } from '../features/stats/StatsPage';
import { invoke } from '../ipc/commands';
import { statsModel, statsRange } from './statsModel';
export function StatsScreen({
  onBack,
  onOpenBook,
}: {
  onBack(): void;
  onOpenBook(id: string): void;
}) {
  const [model, setModel] = useState<ReturnType<typeof statsModel>>();
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const today = new Date();
    void Promise.all([
      invoke('stats_query', statsRange(today)),
      invoke('library_list', {}).catch(() => []),
    ])
      .then(([result, library]) => {
        if (!disposed) setModel(statsModel(result, today, library ?? []));
      })
      .catch((e: unknown) => {
        if (!disposed) setError(errorCopy(e));
      });
    return () => {
      disposed = true;
    };
  }, []);
  if (!model)
    return (
      <main>
        <button onClick={onBack}>Library</button>
        <p role={error ? 'alert' : 'status'}>{error || 'Loading reading stats…'}</p>
      </main>
    );
  return <StatsPage {...model} onBack={onBack} onOpenBook={onOpenBook} />;
}
