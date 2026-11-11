import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Settings, SettingsPatch } from '@contract/types';
import defaults from '../../contract/settings.defaults.json';
import { createSettingsStore } from './settingsStore';
import { mergePatch } from './appearance';
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../ipc/commands', () => ({ invoke: ipc.invoke }));
let disk: Settings;
let legacy: unknown;
let store: ReturnType<typeof createSettingsStore>;
beforeEach(async () => {
  vi.useFakeTimers();
  ipc.invoke.mockReset();
  legacy = null;
  disk = structuredClone(defaults) as Settings;
  ipc.invoke.mockImplementation(
    async (command: string, args: { patch?: SettingsPatch; value?: unknown }) => {
      if (command === 'settings_get') return structuredClone(disk);
      if (command === 'kv_get') return legacy;
      if (command === 'kv_set') {
        legacy = args.value;
        return null;
      }
      if (command === 'settings_patch') {
        disk = mergePatch(disk, args.patch);
        disk.styleOverrides ??= {};
        return structuredClone(disk);
      }
    },
  );
  store = createSettingsStore();
  await store.getState().load();
  ipc.invoke.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const state = () => store.getState();
const writes = () => ipc.invoke.mock.calls.filter(([name]) => name === 'settings_patch');
it('loads once and puts built-ins first in the selectors', async () => {
  await state().load();
  expect(ipc.invoke).not.toHaveBeenCalled();
  expect(state().presetsList.map((p) => p.id)).toEqual([
    'builtin.dark',
    'builtin.sepia',
    'builtin.light',
    'builtin.night',
  ]);
  expect(state().effectiveStyle.font.size).toBe(20);
});
it('previews immediately, debounces for 300ms and coalesces one patch', async () => {
  state().patchStyle({ font: { size: 21 } });
  expect(state().effectiveStyle.font.size).toBe(21);
  await vi.advanceTimersByTimeAsync(200);
  state().patchStyle({ font: { size: 22 }, text: { lineHeight: 2 } });
  await vi.advanceTimersByTimeAsync(299);
  expect(writes()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(writes()).toHaveLength(1);
  expect(writes()[0]?.[1]).toEqual({
    patch: { styleOverrides: { font: { size: 22 }, text: { lineHeight: 2 } } },
  });
});
it('clamps all numeric style and reader inputs using schema ranges', () => {
  state().patchStyle({
    font: { size: 100.2, weight: 1 },
    text: { lineHeight: 0, letterSpacing: 2 },
    layout: { marginX: 999, maxLineWidthEm: 1 },
  });
  expect(state().effectiveStyle).toMatchObject({
    font: { size: 72, weight: 100 },
    text: { lineHeight: 1, letterSpacing: 0.3 },
    layout: { marginX: 400, maxLineWidthEm: 15 },
  });
  state().patchStyle({ layout: { maxLineWidthEm: -1 } });
  expect(state().effectiveStyle.layout.maxLineWidthEm).toBe(0);
  state().setReader({
    reader: { pagesPerView: 9 as 1 },
    layout: { minSpreadWidthPx: 2 },
    scroll: { arrowSpeed: 9999, tapLines: 2.6 },
  });
  expect(state().settings).toMatchObject({
    reader: { pagesPerView: 2 },
    layout: { minSpreadWidthPx: 600 },
    scroll: { arrowSpeed: 4000, tapLines: 3 },
  });
  expect(() => state().patchStyle({ colors: { text: 'invalid' } })).toThrow();
  expect(() => state().patchStyle({ font: { size: NaN } })).toThrow();
});
it('tracks modified and reset dots and resets size to the active custom preset', () => {
  state().patchStyle({ font: { size: 24 } });
  const id = state().saveAsPreset('Mine');
  state().patchStyle({ font: { size: 30 }, text: { lineHeight: 2 } });
  expect(state().isModified()).toBe(true);
  expect(state().isOverridden('font.size')).toBe(true);
  state().resetStyleKey('font.size');
  expect(state().effectiveStyle.font.size).toBe(24);
  expect(state().isOverridden('font.size')).toBe(false);
  expect(state().settings.activePresetId).toBe(id);
  state().revertPreset();
  expect(state().isModified()).toBe(false);
});
it('removes equal-to-preset overrides and produces no write for a reverted edit', async () => {
  state().patchStyle({ font: { size: 24 } });
  state().patchStyle({ font: { size: 20 } });
  expect(state().isModified()).toBe(false);
  await state().flush();
  expect(writes()).toHaveLength(0);
});
it('saves effective style, activates custom presets, updates and reverts', async () => {
  state().patchStyle({ font: { size: 23 } });
  const id = state().saveAsPreset('Evening');
  expect(state().isModified()).toBe(false);
  expect(state().settings.activePresetId).toBe(id);
  state().patchStyle({ font: { size: 27 } });
  state().updatePreset();
  expect(state().settings.presets[0]?.style.font.size).toBe(27);
  expect(state().isModified()).toBe(false);
  state().patchStyle({ font: { size: 29 } });
  state().revertPreset();
  expect(state().effectiveStyle.font.size).toBe(27);
  await state().flush();
  expect(disk.presets[0]?.style.font.size).toBe(27);
});
it('selects presets and protects built-ins from all mutations', () => {
  state().patchStyle({ font: { size: 21 } });
  state().selectPreset('builtin.sepia');
  expect(state().isModified()).toBe(false);
  expect(state().effectiveStyle.colors.background).toBe(
    state().presetsList[1]?.style.colors.background,
  );
  expect(() => state().updatePreset()).toThrow();
  expect(() => state().renamePreset('builtin.dark', 'Oops')).toThrow();
  expect(() => state().deletePreset('builtin.dark')).toThrow();
  expect(() => state().selectPreset('missing')).toThrow();
});
it('renames custom presets and rejects blank, long and duplicate names', () => {
  const id = state().saveAsPreset('Mine');
  state().renamePreset(id, 'Yours');
  expect(state().settings.presets[0]?.name).toBe('Yours');
  for (const name of ['', ' ', 'a'.repeat(61), 'Dark', 'yours'])
    expect(() => state().saveAsPreset(name)).toThrow();
});
it('deletes the active preset with fallback and undo preserving intervening presets', () => {
  const id = state().saveAsPreset('Mine');
  state().patchStyle({ font: { size: 26 } });
  const undo = state().deletePreset(id);
  expect(state().settings.activePresetId).toBe('builtin.dark');
  expect(state().isModified()).toBe(false);
  state().saveAsPreset('Other');
  undo();
  undo();
  expect(state().settings.presets.map((p) => p.name)).toEqual(['Mine', 'Other']);
  expect(state().settings.activePresetId).not.toBe(id);
});
it('undo restores an active deleted preset and overrides without a preset switch', () => {
  const id = state().saveAsPreset('Mine');
  state().patchStyle({ font: { size: 26 } });
  const undo = state().deletePreset(id);
  undo();
  expect(state().settings.activePresetId).toBe(id);
  expect(state().effectiveStyle.font.size).toBe(26);
});
it('retains reset nulls when revert and a new edit coalesce before persistence', async () => {
  state().patchStyle({ font: { size: 25 }, text: { lineHeight: 2 } });
  await state().flush();
  state().revertPreset();
  state().patchStyle({ font: { size: 26 } });
  await state().flush();
  expect(disk.styleOverrides).toEqual({ font: { size: 26 } });
});
it('serializes writes and keeps edits made during an in-flight request', async () => {
  let finish!: (value: Settings) => void;
  ipc.invoke.mockImplementationOnce(
    () =>
      new Promise<Settings>((resolve) => {
        finish = resolve;
      }),
  );
  state().patchStyle({ font: { size: 25 } });
  const flush = state().flush();
  state().patchStyle({ font: { size: 28 } });
  expect(writes()).toHaveLength(1);
  const returned = mergePatch(disk, { styleOverrides: { font: { size: 25 } } });
  finish(returned);
  await flush;
  expect(writes()).toHaveLength(2);
  expect(state().effectiveStyle.font.size).toBe(28);
});
it('keeps failed edits for a later flush and surfaces the error', async () => {
  ipc.invoke.mockRejectedValueOnce(new Error('disk full'));
  state().patchStyle({ font: { size: 25 } });
  await expect(state().flush()).rejects.toThrow('disk full');
  expect(state().effectiveStyle.font.size).toBe(25);
  await state().flush();
  expect(disk.styleOverrides.font?.size).toBe(25);
  expect(state().error).toBeNull();
});
it('migrates a valid legacy preference once and clears the old kv', async () => {
  legacy = 2;
  store = createSettingsStore();
  await state().load();
  expect(state().settings.reader.pagesPerView).toBe(2);
  expect(legacy).toBeNull();
  expect(disk.reader.pagesPerView).toBe(2);
});
it('does not replace a non-default settings preference with legacy kv', async () => {
  legacy = 1;
  disk.reader.pagesPerView = 2;
  store = createSettingsStore();
  await state().load();
  expect(state().settings.reader.pagesPerView).toBe(2);
  expect(legacy).toBeNull();
});
it('keeps the 300ms debounce for edits made during an automatic write', async () => {
  let finish!: (value: Settings) => void;
  ipc.invoke.mockImplementationOnce(
    () =>
      new Promise<Settings>((resolve) => {
        finish = resolve;
      }),
  );
  state().patchStyle({ font: { size: 25 } });
  await vi.advanceTimersByTimeAsync(300);
  state().patchStyle({ font: { size: 28 } });
  finish(mergePatch(disk, { styleOverrides: { font: { size: 25 } } }));
  await vi.advanceTimersByTimeAsync(299);
  expect(writes()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(writes()).toHaveLength(2);
  expect(state().effectiveStyle.font.size).toBe(28);
});

it('persists the last Settings pane and resets numeric values without missing effective keys', async () => {
  state().patch({ ui: { settingsLastPane: 'reading' }, scroll: { arrowSpeed: 9999 } });
  expect(state().settings.scroll.arrowSpeed).toBe(4000);
  await state().flush();
  state().patch({ scroll: { arrowSpeed: null } });
  expect(state().settings.scroll.arrowSpeed).toBe(defaults.scroll.arrowSpeed);
  await state().flush();
  const reopened = createSettingsStore();
  await reopened.getState().load();
  expect(reopened.getState().settings.ui.settingsLastPane).toBe('reading');
  expect(reopened.getState().settings.scroll.arrowSpeed).toBe(defaults.scroll.arrowSpeed);
});

it('replaces backend settings without echo and rebases pending UI edits', async () => {
  state().patch({ chrome: { autoHideDelayMs: 3000 } });
  const remote = structuredClone(disk);
  remote.bossKey.shortcut = 'Ctrl+Alt+J';
  remote.library.folder = 'C:\\Books';
  state().replace(remote);
  expect(writes()).toHaveLength(0);
  expect(state().settings.bossKey.shortcut).toBe('Ctrl+Alt+J');
  expect(state().settings.chrome.autoHideDelayMs).toBe(3000);
  disk = remote;
  await state().flush();
  expect(writes()[0]?.[1]).toEqual({ patch: { chrome: { autoHideDelayMs: 3000 } } });
});

it('persists, resets one binding, and resets all keybindings', async () => {
  state().patch({ keybindings: { 'page.next': ['J'], 'toc.toggle': [] } });
  await state().flush();
  expect(disk.keybindings['page.next']).toEqual(['J']);
  state().patch({ keybindings: { 'page.next': null } });
  expect(state().settings.keybindings['page.next']).toBeUndefined();
  expect(state().settings.keybindings['toc.toggle']).toEqual([]);
  state().patch({ keybindings: null });
  expect(state().settings.keybindings).toEqual({});
  await state().flush();
});

it('does not echo managed keys when a backend event arrives during an in-flight UI write', async () => {
  let finish!: (value: Settings) => void;
  ipc.invoke.mockImplementationOnce(
    () =>
      new Promise<Settings>((resolve) => {
        finish = resolve;
      }),
  );
  state().patch({ scroll: { arrowSpeed: 1000 } });
  const writing = state().flush();
  const response = mergePatch(disk, { scroll: { arrowSpeed: 1000 } });
  const remote = structuredClone(response);
  remote.bossKey.shortcut = 'Ctrl+Alt+J';
  disk = remote;
  state().replace(remote);
  state().patch({ chrome: { autoHideDelayMs: 3500 } });
  finish(response);
  await writing;
  expect(writes()).toHaveLength(2);
  expect(writes()[1]?.[1]).toEqual({ patch: { chrome: { autoHideDelayMs: 3500 } } });
  expect(state().settings.bossKey.shortcut).toBe('Ctrl+Alt+J');
});
