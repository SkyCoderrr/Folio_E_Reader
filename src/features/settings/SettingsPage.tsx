import type { KeyboardEvent, ReactNode } from 'react';
import { SETTINGS_PANES } from '@contract/types';
import type {
  ActionId,
  BossKeyStatus,
  Chord,
  Settings,
  SettingsPane,
  SettingsPatch,
} from '@contract/types';
import { IconButton } from '../../ui/IconButton';
import { ArrowLeftIcon } from '../../ui/icons';
import { TitleBar } from '../../ui/TitleBar';
import { KeyboardPane, type KeymapEntry } from './KeyboardPane';
import {
  AboutPane,
  GeneralPane,
  LibraryPane,
  ReadingPane,
  ScrollingPane,
  StatsPane,
  TxtPane,
} from './panes';
import { PANE_LABELS } from './paneLabels';
import styles from './settings.module.css';

export interface SettingsPageProps {
  settings: Settings;
  pane: SettingsPane;
  onPaneChange: (pane: SettingsPane) => void;
  onPatch: (patch: SettingsPatch) => void;
  onBack: () => void;
  bossStatus: BossKeyStatus | null;
  debugBuild?: boolean;
  onBossShortcut: (chord: Chord) => Promise<void>;
  onBossEnabled: (b: boolean) => void;
  libraryDir: string;
  onPickLibraryFolder: () => void;
  onResetLibraryFolder: () => void;
  appVersion: string;
  contractVersion: string;
  keymap: {
    actionId: ActionId;
    label: string;
    scope: string;
    chords: string[];
    defaults: string[];
  }[];
  onRebind: (actionId: ActionId, chords: string[]) => void;
  onResetBinding: (actionId: ActionId) => void;
  onResetAllBindings: () => void;
  /** App-level alerts (boss key unavailable, save errors), shown above the pane content. */
  alerts?: ReactNode;
}

export function SettingsPage(p: SettingsPageProps) {
  const { settings, pane } = p;

  const onNavKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = SETTINGS_PANES.indexOf(pane);
    const next = SETTINGS_PANES[(i + step + SETTINGS_PANES.length) % SETTINGS_PANES.length]!;
    p.onPaneChange(next);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${next}`)?.focus());
  };

  const common = { settings, onPatch: p.onPatch };
  return (
    <div className={styles.page}>
      <TitleBar
        title={<h1 className={styles.title}>Settings</h1>}
        leading={
          <IconButton label="Back" action="dismiss" align="start" onClick={p.onBack}>
            <ArrowLeftIcon />
          </IconButton>
        }
      />
      <div className={styles.body}>
        <nav
          className={styles.nav}
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings"
          onKeyDown={onNavKey}
        >
          {SETTINGS_PANES.map((id) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={id === pane}
              aria-controls="settings-panel"
              tabIndex={id === pane ? 0 : -1}
              className={styles.navItem}
              onClick={() => p.onPaneChange(id)}
            >
              {PANE_LABELS[id]}
            </button>
          ))}
        </nav>
        <main
          className={styles.pane}
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${pane}`}
        >
          <div className={styles.paneInner}>
            {p.alerts ? <div className={styles.alerts}>{p.alerts}</div> : null}
            {/* Focus lands here on open (no ring, no tooltip); Tab moves into the pane. */}
            <h2 className={styles.paneTitle} tabIndex={-1} data-settings-autofocus>
              {PANE_LABELS[pane]}
            </h2>
            {pane === 'general' && <GeneralPane {...common} />}
            {pane === 'reading' && <ReadingPane {...common} />}
            {pane === 'scrolling' && <ScrollingPane {...common} />}
            {pane === 'keyboard' && (
              <KeyboardPane
                keymap={p.keymap as KeymapEntry[]}
                bossChord={p.bossStatus?.shortcut ?? settings.bossKey.shortcut}
                bossEnabled={p.bossStatus?.enabled ?? settings.bossKey.enabled}
                bossStatus={p.bossStatus}
                debugBuild={p.debugBuild}
                onBossShortcut={p.onBossShortcut}
                onBossEnabled={p.onBossEnabled}
                onRebind={p.onRebind}
                onResetBinding={p.onResetBinding}
                onResetAllBindings={p.onResetAllBindings}
              />
            )}
            {pane === 'library' && (
              <LibraryPane
                {...common}
                libraryDir={p.libraryDir}
                onPickLibraryFolder={p.onPickLibraryFolder}
                onResetLibraryFolder={p.onResetLibraryFolder}
              />
            )}
            {pane === 'txtCjk' && <TxtPane {...common} />}
            {pane === 'stats' && <StatsPane {...common} />}
            {pane === 'about' && (
              <AboutPane appVersion={p.appVersion} contractVersion={p.contractVersion} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
