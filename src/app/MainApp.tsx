import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { AppInfo, BossKeyStatus, BookRecord } from '@contract/types';
import { toast } from 'sonner';
import { loadSettings, flushSettings, useSettings } from '../state/settingsStore';
import { useLibrary, errorMessage } from '../state/libraryStore';
import { invoke } from '../ipc/commands';
import { listen } from '../ipc/events';
import { ReaderView } from '../features/reader/ReaderView';
import { LibraryView } from '../features/library/LibraryView';
import { DropOverlay } from '../features/library/DropOverlay';
import { Toaster } from '../ui/Toaster';
import { listenForBookDrops } from './dragDrop';
import { QuitContext } from './quitContext';
import { TxtSettingsDialogs, type TxtSettingsTarget } from '../features/txt/TxtSettingsDialogs';
import { StatsScreen } from './StatsScreen';
import { SettingsScreen } from './SettingsScreen';
import { installKeyRouter } from '../engine/input/keyRouter';
import { statsRange, timeLeftByBook } from './statsModel';
import { watchKeyboardLayout } from '../engine/input/keyboardLayout';
import { pauseReading } from '../engine/input/pauseBus';
const report = (e: unknown) => {
  toast.error(errorMessage(e));
};
const coverUrl = (book: BookRecord) => (book.coverPath ? convertFileSrc(book.coverPath) : null);
export default function MainApp() {
  const [, layoutChanged] = useState(0);
  useEffect(() => watchKeyboardLayout(() => layoutChanged((v) => v + 1)), []);
  const [timeLeft, setTimeLeft] = useState<Record<string, number>>({});
  const statsEnabled = useSettings((s) => s.settings.stats.enabled);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bossStatus, setBossStatus] = useState<BossKeyStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const openSettings = useCallback(() => {
    pauseReading();
    setSettingsOpen(true);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [txtTarget, setTxtTarget] = useState<TxtSettingsTarget | null>(null);
  const library = useLibrary();
  const { opened, refresh } = library;
  useEffect(() => {
    if (!loaded || opened) return;
    let disposed = false;
    if (!statsEnabled) return;
    void invoke('stats_query', statsRange()).then((result) => {
      if (!disposed) setTimeLeft(timeLeftByBook(result, library.books));
    }).catch(report);
    return () => { disposed = true; };
  }, [loaded, opened, statsOpen, statsEnabled, library.books]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const quitting = useRef(false);
  const back = useCallback(() => useLibrary.getState().close(), []);
  const quit = useCallback(() => {
    if (quitting.current) return;
    quitting.current = true;
    void (async () => {
      // Native X / Alt+F4 and accessible caption activation share this bounded flush.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([saveRef.current?.(), flushSettings()]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 1500);
          }),
        ]);
      } catch (e) {
        console.warn('Position flush failed', e);
      } finally {
        clearTimeout(timer);
      }
      await invoke('app_quit', {});
    })().catch((e: unknown) => {
      quitting.current = false;
      setError(String(e));
    });
  }, []);
  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    void (async () => {
      keep(await listen('app://close-requested', quit));
      keep(await listen('tray://open-settings', openSettings));
      keep(
        await listen('tray://open-library', () => {
          pauseReading();
          void Promise.resolve(saveRef.current?.())
            .then(() => {
              setSettingsOpen(false);
              setStatsOpen(false);
              back();
            })
            .catch(report);
        }),
      );
      keep(await listen('boss://hidden', pauseReading));
      keep(await listen('boss://shown', () => undefined));
      const statusChanged = (status: BossKeyStatus) => {
        if (disposed || !status) return;
        setBossStatus(status);
        if (status.enabled && !status.registered)
          toast.error('Boss key unavailable: ' + (status.error?.message ?? status.shortcut));
      };
      keep(
        await listen('boss://register-failed', (event) => {
          statusChanged({ enabled: true, registered: false, ...event });
        }),
      );
      keep(
        await listen('settings://changed', ({ settings }) => {
          void invoke('app_info', {})
            .then((value) => {
              if (!disposed) setInfo(value);
            })
            .catch(report);
          useSettings.getState().replace(settings);
          setBossStatus((status) => (status ? { ...status, ...settings.bossKey } : status));
        }),
      );
      if (disposed) return;
      keep(await useLibrary.getState().connect());
      if (disposed) return;
      keep(
        await listenForBookDrops(setDragging, (paths) => {
          void useLibrary.getState().importPaths(paths).catch(report);
        }),
      );
      if (disposed) return;
      await loadSettings();
      statusChanged(await invoke('boss_get_status', {}));
      const appInfo = await invoke('app_info', {});
      if (!disposed) setInfo(appInfo);
      if (!disposed) setLoaded(true);
    })().catch((e: unknown) => {
      if (!disposed) setError(errorMessage(e));
    });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [quit, back, openSettings]);
  useEffect(() => {
    if (loaded && !opened) void refresh().catch(report);
  }, [loaded, opened, refresh]);
  useEffect(
    () =>
      installKeyRouter(window, {
        scopes: () => ['app'],
        bindings: () => useSettings.getState().settings.keybindings,
        handle: (action, phase) => {
          if (phase === 'up') return true;
          if (action === 'settings.open') {
            openSettings();
            return true;
          }
          if (action === 'app.quit') {
            quit();
            return true;
          }
          return false;
        },
      }),
    [openSettings, quit],
  );
  useEffect(() => {
    if (!settingsOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (
        event.code !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      event.preventDefault();
      setSettingsOpen(false);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [settingsOpen]);
  if (!loaded) return <div role="status">{error || 'Loading settings...'}</div>;
  return (
    <QuitContext.Provider value={quit}>
      <Toaster />
      <div inert={settingsOpen || undefined}>
        {statsOpen ? (
          <StatsScreen
            onBack={() => setStatsOpen(false)}
            onOpenBook={(id) => {
              void library
                .open(id)
                .then(() => setStatsOpen(false))
                .catch(report);
            }}
          />
        ) : library.opened ? (
          <ReaderView
            key={library.opened.id}
            book={library.opened}
            onBack={back}
            onQuit={quit}
            onSettings={openSettings}
            suspended={settingsOpen}
            saveRef={saveRef}
          />
        ) : (
          <LibraryView
            libraryOffline={info?.libraryOffline}
            onStats={() => setStatsOpen(true)}
            onSettings={openSettings}
            books={library.books}
            timeLeftMs={statsEnabled ? timeLeft : {}}
            view={library.view}
            sort={library.sort}
            sortDir={library.sortDir}
            filter={library.filter}
            formatFilter={library.formatFilter}
            query={library.query}
            selection={library.selection}
            importing={library.importing}
            coverUrl={coverUrl}
            onViewChange={library.setView}
            onSortChange={library.setSort}
            onFilterChange={library.setFilter}
            onFormatFilterChange={library.setFormatFilter}
            onQueryChange={library.setQuery}
            onSelectionChange={library.setSelection}
            onEncoding={(bookId) => setTxtTarget({ bookId, mode: 'encoding' })}
            onChapterDetection={(bookId) => setTxtTarget({ bookId, mode: 'chapters' })}
            onOpen={(id) => {
              void library.open(id).catch(report);
            }}
            onRemove={(ids) => {
              void library.remove(ids).catch(report);
            }}
            onAddBooks={() => {
              void library.pickAndImport().catch(report);
            }}
          />
        )}
      </div>
      {settingsOpen && (
        <div
          data-settings-screen
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10,
            background: 'var(--surface-0)',
            overflow: 'auto',
          }}
        >
          <SettingsScreen
            onBack={() => setSettingsOpen(false)}
            bossStatus={bossStatus}
            onBossStatus={setBossStatus}
            info={info}
          />
        </div>
      )}
      <DropOverlay visible={dragging} />
      {txtTarget && (
        <TxtSettingsDialogs
          key={txtTarget.bookId}
          target={txtTarget}
          onClose={() => setTxtTarget(null)}
        />
      )}
      {error && <div role="alert">{error}</div>}
    </QuitContext.Provider>
  );
}
