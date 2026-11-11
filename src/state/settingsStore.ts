import { create } from 'zustand';
import type { ReadingStyle, Settings, SettingsPatch, Preset } from '@contract/types';
import defaults from '../../contract/settings.defaults.json';
import { invoke } from '../ipc/commands';
import {
  activePreset,
  atPath,
  clampPatch,
  effectiveStyle as computeStyle,
  mergePatch,
  pathPatch,
  presetsList as listPresets,
  prune,
  type DeepPartial,
} from './appearance';
export type { DeepPartial } from './appearance';
export { useFonts } from './useFonts';
export interface SettingsState {
  settings: Settings;
  loaded: boolean;
  error: unknown;
  effectiveStyle: ReadingStyle;
  presetsList: Preset[];
  load(): Promise<void>;
  patch(patch: SettingsPatch): void;
  replace(settings: Settings): void;
  flush(): Promise<void>;
  patchStyle(partial: DeepPartial<ReadingStyle>): void;
  resetStyleKey(path: string): void;
  isOverridden(path: string): boolean;
  isModified(): boolean;
  selectPreset(id: string): void;
  saveAsPreset(name: string): string;
  updatePreset(): void;
  revertPreset(): void;
  renamePreset(id: string, name: string): void;
  deletePreset(id: string): () => void;
  setReader(partial: DeepPartial<Pick<Settings, 'reader' | 'layout' | 'scroll'>>): void;
  setLibrary(
    partial: Partial<Pick<Settings['library'], 'view' | 'sort' | 'sortDir' | 'filter'>>,
  ): void;
}
function complete(settings: Settings): Settings {
  const fill = (value: Record<string, unknown>, fallback: Record<string, unknown>) => {
    for (const [key, item] of Object.entries(fallback)) {
      if (!(key in value)) value[key] = structuredClone(item);
      else if (item && typeof item === 'object' && !Array.isArray(item))
        fill(value[key] as Record<string, unknown>, item as Record<string, unknown>);
    }
  };
  fill(settings as unknown as Record<string, unknown>, defaults);
  return settings;
}
function derived(settings: Settings) {
  return { settings, effectiveStyle: computeStyle(settings), presetsList: listPresets(settings) };
}
/** Each store instance owns one debouncer and one serialized IPC writer. */
export function createSettingsStore() {
  let pending: SettingsPatch = {};
  let backendRevision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | undefined;
  let loading: Promise<void> | undefined;
  let inFlightBase: Settings | undefined;
  let acknowledged = structuredClone(defaults) as Settings;
  return create<SettingsState>((set, get) => {
    const flush = (drain = true): Promise<void> => {
      clearTimeout(timer);
      if (writing) return writing.then(() => flush(drain));
      if (!Object.keys(pending).length) return Promise.resolve();
      const patch = pending;
      pending = {};
      inFlightBase = mergePatch(acknowledged, patch);
      inFlightBase.styleOverrides ??= {};
      const revision = backendRevision;
      writing = invoke('settings_patch', { patch })
        .then((settings) => {
          if (revision !== backendRevision)
            settings = {
              ...settings,
              bossKey: acknowledged.bossKey,
              library: { ...settings.library, folder: acknowledged.library.folder },
            };
          acknowledged = settings;
          // Edits made during IPC remain visible and will be sent next.
          const optimistic = complete(mergePatch(settings, pending));
          optimistic.styleOverrides = prune(
            (optimistic.styleOverrides ?? {}) as Record<string, unknown>,
          );
          set({ ...derived(optimistic), error: null });
        })
        .catch((error: unknown) => {
          pending = diff(acknowledged, get().settings) as SettingsPatch;
          set({ error });
          throw error;
        })
        .finally(() => {
          writing = undefined;
          inFlightBase = undefined;
        });
      return drain ? writing.then(() => flush()) : writing;
    };
    const change = (patch: SettingsPatch) => {
      const settings = complete(mergePatch(get().settings, patch));
      // Overrides reset to an empty object; other actions send complete groups.
      settings.styleOverrides = prune((settings.styleOverrides ?? {}) as Record<string, unknown>);
      pending = diff(inFlightBase ?? acknowledged, settings) as SettingsPatch;
      set({ ...derived(settings), error: null });
      clearTimeout(timer);
      timer = setTimeout(() => {
        void flush(false).catch(() => undefined);
      }, 300);
    };
    const custom = (id: string) => {
      const preset = get().settings.presets.find((p) => p.id === id);
      if (!preset) throw new Error('Built-in presets cannot be changed');
      return preset;
    };
    const nameFor = (name: string, except?: string) => {
      const value = name.trim();
      if (!value || [...value].length > 60) throw new Error('Enter a name of 1–60 characters');
      if (
        get().presetsList.some(
          (p) => p.id !== except && p.name.toLowerCase() === value.toLowerCase(),
        )
      )
        throw new Error('Preset name already exists');
      return value;
    };
    return {
      ...derived(acknowledged),
      loaded: false,
      error: null,
      flush,
      patch: (patch) => {
        const { keybindings, ...rest } = patch;
        change({ ...clampPatch(rest), ...('keybindings' in patch ? { keybindings } : {}) });
      },
      replace: (settings) => {
        backendRevision++;
        acknowledged = structuredClone(settings);
        if (inFlightBase)
          inFlightBase = {
            ...inFlightBase,
            bossKey: settings.bossKey,
            library: { ...inFlightBase.library, folder: settings.library.folder },
          };
        set({ ...derived(complete(mergePatch(settings, pending))), error: null });
      },
      load: () => {
        if (loading) return loading;
        if (get().loaded) return Promise.resolve();
        loading ??= (async () => {
          try {
            acknowledged = await invoke('settings_get', {});
            set({ ...derived(acknowledged), loaded: true, error: null });
            const legacy = await invoke('kv_get', { key: 'reader.pagesPerView' });
            if (legacy === 1 || legacy === 2) {
              if (acknowledged.reader.pagesPerView === defaults.reader.pagesPerView) {
                get().setReader({ reader: { pagesPerView: legacy } });
                await flush();
              }
              await invoke('kv_set', { key: 'reader.pagesPerView', value: null });
            }
          } catch (error) {
            set({ loaded: false, error });
            throw error;
          } finally {
            loading = undefined;
          }
        })();
        return loading;
      },
      patchStyle: (partial) => {
        const patch = clampPatch({ styleOverrides: partial }).styleOverrides;
        // Equal-to-preset values remove overrides so reset dots reflect differences.
        for (const [group, values] of Object.entries(patch)) {
          for (const [key, value] of Object.entries(values as object)) {
            if (atPath(activePreset(get().settings).style, `${group}.${key}`) === value) {
              (values as Record<string, unknown>)[key] = null;
            }
          }
        }
        change({ styleOverrides: patch });
      },
      resetStyleKey: (path) => {
        // Validate the path before null can hide a typo.
        if (atPath(activePreset(get().settings).style, path) === undefined)
          throw new Error('Unknown style key');
        change({ styleOverrides: pathPatch(path, null) });
      },
      isOverridden: (path) => atPath(get().settings.styleOverrides, path) !== undefined,
      isModified: () => Object.keys(get().settings.styleOverrides).length > 0,
      selectPreset: (id) => {
        if (!get().presetsList.some((p) => p.id === id)) throw new Error('Unknown preset');
        change({ activePresetId: id, styleOverrides: null });
      },
      saveAsPreset: (name) => {
        const id = `custom.${crypto.randomUUID()}`;
        const preset: Preset = {
          id,
          name: nameFor(name),
          builtIn: false,
          style: structuredClone(get().effectiveStyle),
          updatedAt: Date.now(),
        };
        change({
          presets: [...get().settings.presets, preset],
          activePresetId: id,
          styleOverrides: null,
        });
        return id;
      },
      updatePreset: () => {
        const p = custom(get().settings.activePresetId);
        const updated = {
          ...p,
          style: structuredClone(get().effectiveStyle),
          updatedAt: Math.max(Date.now(), p.updatedAt + 1),
        };
        change({
          presets: get().settings.presets.map((v) => (v.id === p.id ? updated : v)),
          styleOverrides: null,
        });
      },
      revertPreset: () => change({ styleOverrides: null }),
      renamePreset: (id, name) => {
        const preset = custom(id);
        const updated = { ...preset, name: nameFor(name, id), updatedAt: Date.now() };
        change({ presets: get().settings.presets.map((p) => (p.id === id ? updated : p)) });
      },
      deletePreset: (id) => {
        const preset = custom(id);
        const before = get().settings;
        const index = before.presets.findIndex((p) => p.id === id);
        const active = before.activePresetId === id;
        change({
          presets: before.presets.filter((p) => p.id !== id),
          ...(active ? { activePresetId: 'builtin.dark', styleOverrides: null } : {}),
        });
        let undone = false;
        return () => {
          if (undone || get().settings.presets.some((p) => p.id === id)) return;
          undone = true;
          const presets = [...get().settings.presets];
          presets.splice(Math.min(index, presets.length), 0, preset);
          change({
            presets,
            ...(active && get().settings.activePresetId === 'builtin.dark'
              ? { activePresetId: id, styleOverrides: before.styleOverrides }
              : {}),
          });
        };
      },
      setReader: (partial) => change(clampPatch(partial)),
      setLibrary: (partial) => change({ library: partial }),
    };
  });
}
/** Compute one patch from acknowledged state to the complete optimistic state. */
export function diff(before: unknown, after: unknown): Record<string, unknown> {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (!(key in b)) result[key] = null;
    else if (b[key] && typeof b[key] === 'object' && !Array.isArray(b[key]))
      result[key] = diff(a[key], b[key]);
    else result[key] = b[key];
  }
  return result;
}
export const useSettings = createSettingsStore();
export const loadSettings = () => useSettings.getState().load();
export const flushSettings = () => useSettings.getState().flush();
export const effectiveStyle = (state: SettingsState) => state.effectiveStyle;
export const presetsList = (state: SettingsState) => state.presetsList;
