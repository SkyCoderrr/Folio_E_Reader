import { useState } from 'react';
import { ACTION_IDS } from '@contract/types';
import type { ActionId, BossKeyStatus, Settings, SettingsPane, SettingsPatch } from '@contract/types';
import defaults from '../../contract/settings.defaults.json';
import { Toaster } from '../ui/kit';
import { DEFAULT_KEYMAP, actionScope } from '../engine/input/keymap';
import { SettingsPage } from '../features/settings/SettingsPage';

const merge = (a: unknown, b: unknown): unknown => {
  if (b === null || typeof b !== 'object' || Array.isArray(b) || typeof a !== 'object' || a === null) return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
  return out;
};
const label = (id: string) =>
  id
    .replace(/\./g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

/** Dev-only (#settings): SettingsPage on local state, no IPC. Null patches are not reset-aware here. */
export default function SettingsDemo() {
  const [settings, setSettings] = useState(defaults as unknown as Settings);
  const [pane, setPane] = useState<SettingsPane>('general');
  const [bindings, setBindings] = useState<Partial<Record<ActionId, string[]>>>({});
  const [boss, setBoss] = useState<BossKeyStatus>({
    enabled: true,
    shortcut: 'Ctrl+Alt+B',
    registered: false,
    error: { code: 'SHORTCUT_IN_USE', message: 'in use' } as never,
  });
  const keymap = ACTION_IDS.map((id) => ({
    actionId: id,
    label: label(id),
    scope: actionScope(id),
    chords: bindings[id] ?? DEFAULT_KEYMAP[id] ?? [],
    defaults: DEFAULT_KEYMAP[id] ?? [],
  }));
  return (
    <div style={{ height: '100vh' }}>
      <SettingsPage
        settings={settings}
        pane={pane}
        onPaneChange={setPane}
        onPatch={(p: SettingsPatch) => setSettings((s) => merge(s, p) as Settings)}
        onBack={() => (location.hash = '')}
        bossStatus={boss}
        onBossShortcut={async (c) => setBoss({ ...boss, shortcut: c, registered: true, error: null })}
        onBossEnabled={(enabled) => setBoss({ ...boss, enabled })}
        libraryDir="C:\Users\you\Documents\E_Reader Library"
        onPickLibraryFolder={() => {}}
        onResetLibraryFolder={() => {}}
        appVersion="0.1.0"
        contractVersion="0.3.0"
        keymap={keymap}
        onRebind={(id, chords) => setBindings((b) => ({ ...b, [id]: chords }))}
        onResetBinding={(id) =>
          setBindings((b) => {
            const next = { ...b };
            delete next[id];
            return next;
          })
        }
        onResetAllBindings={() => setBindings({})}
      />
      <Toaster />
    </div>
  );
}
