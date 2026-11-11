import type { ReadingStyle } from '@contract/types';
import { useSettings, type DeepPartial } from '../../state/settingsStore';
import { atPath, pathPatch } from '../../state/appearance';

export function useStyleValue<T>(path: string): T {
  return useSettings((s) => atPath(s.effectiveStyle, path)) as T;
}
export function useOverridden(path: string): boolean {
  return useSettings((s) => atPath(s.settings.styleOverrides, path) !== undefined);
}
export function setStyle(path: string, value: unknown) {
  useSettings.getState().patchStyle(pathPatch(path, value) as DeepPartial<ReadingStyle>);
}
export function resetStyle(path: string) {
  useSettings.getState().resetStyleKey(path);
}
