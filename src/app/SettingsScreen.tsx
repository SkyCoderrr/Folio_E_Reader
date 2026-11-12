import { useEffect, useRef, useState } from 'react';
import { ACTION_IDS } from '@contract/types';
import type { AppInfo, BossKeyStatus } from '@contract/types';
import { invoke } from '../ipc/commands';
import { bossKeyFailureCopy } from '../ipc/errorCopy';
import { useSettings, flushSettings } from '../state/settingsStore';
import { useLibrary, errorMessage } from '../state/libraryStore';
import { DEFAULT_KEYMAP, actionScope } from '../engine/input/keymap';
import { SettingsPage } from '../features/settings/SettingsPage';
import { actionLabel } from '../features/settings/actionLabels';
import { Button, Dialog } from '../ui/kit';

export function SettingsScreen({
  onBack,
  bossStatus,
  onBossStatus,
  info,
}: {
  onBack(): void;
  bossStatus: BossKeyStatus | null;
  onBossStatus(status: BossKeyStatus): void;
  info: AppInfo | null;
}) {
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Focus the pane heading, not Back: no focus ring or tooltip on open.
    screen.current?.querySelector<HTMLElement>('[data-settings-autofocus]')?.focus();
    return () => previous?.focus();
  }, []);
  const { settings, patch, error } = useSettings();
  const [message, setMessage] = useState('');
  const [folder, setFolder] = useState<{ path: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [libraryDir, setLibraryDir] = useState<string | null>(null);
  const boss = async (
    command: 'boss_set_shortcut' | 'boss_set_enabled',
    value: string | boolean,
  ) => {
    setMessage('');
    try {
      await flushSettings();
      const status =
        command === 'boss_set_shortcut'
          ? await invoke(command, { shortcut: value as string })
          : await invoke(command, { enabled: value as boolean });
      onBossStatus(status);
    } catch (e) {
      setMessage(errorMessage(e));
      throw e;
    }
  };
  const changeFolder = async (moveFiles: boolean) => {
    if (!folder || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await flushSettings();
      const result = await invoke('library_set_folder', { path: folder.path, moveFiles });
      setLibraryDir(result.libraryDir);
      setFolder(null);
      if (result.failed.length) setMessage(result.failed.map((f) => errorMessage(f)).join('; '));
      await useLibrary.getState().refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={screen} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <SettingsPage
          alerts={
            <>
              {bossStatus?.enabled && !bossStatus.registered && (
                <div role="alert">
                  {bossKeyFailureCopy(bossStatus.shortcut, bossStatus.error)}
                </div>
              )}
              {Boolean(message || error) && (
                <div role="alert">{message || errorMessage(error)}</div>
              )}
            </>
          }
          settings={settings}
          pane={settings.ui.settingsLastPane}
          onPaneChange={(pane) => patch({ ui: { settingsLastPane: pane } })}
          onPatch={(p) => {
            try {
              patch(p);
            } catch (e) {
              setMessage(errorMessage(e));
            }
          }}
          onBack={onBack}
          bossStatus={bossStatus}
          debugBuild={info?.isDebugBuild}
          onBossShortcut={(chord) => boss('boss_set_shortcut', chord)}
          onBossEnabled={(enabled) => {
            void boss('boss_set_enabled', enabled).catch(() => undefined);
          }}
          libraryDir={
            libraryDir ?? settings.library.folder ?? info?.libraryDir ?? 'Loading library folder...'
          }
          onPickLibraryFolder={() => {
            void invoke('dialog_pick_folder', {})
              .then((path) => {
                if (path) setFolder({ path });
              })
              .catch((e: unknown) => setMessage(errorMessage(e)));
          }}
          onResetLibraryFolder={() => setFolder({ path: null })}
          appVersion={info?.appVersion ?? ''}
          contractVersion={info?.contractVersion ?? ''}
          keymap={ACTION_IDS.map((actionId) => ({
            actionId,
            label: actionLabel(actionId),
            scope: actionScope(actionId),
            chords: settings.keybindings[actionId] ?? DEFAULT_KEYMAP[actionId] ?? [],
            defaults: DEFAULT_KEYMAP[actionId] ?? [],
          }))}
          onRebind={(id, chords) => patch({ keybindings: { [id]: chords } })}
          onResetBinding={(id) => patch({ keybindings: { [id]: null } })}
          onResetAllBindings={() => patch({ keybindings: null })}
        />
      </div>
      <Dialog
        open={folder !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setFolder(null);
        }}
        title="Move existing books?"
        description="Move your existing book copies into the selected library folder?"
        actions={
          <>
            <Button disabled={busy} variant="ghost" onClick={() => setFolder(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void changeFolder(false)}>
              Keep existing files
            </Button>
            <Button disabled={busy} onClick={() => void changeFolder(true)}>
              Move books
            </Button>
          </>
        }
      />
    </div>
  );
}
