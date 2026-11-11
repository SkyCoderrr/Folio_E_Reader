import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { ERROR_CODES } from '@contract/types';
import type { AppError, CommandName, CommandArgs, CommandResult } from '@contract/types';
export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.message === 'string' && ERROR_CODES.some((code) => code === e.code);
}
export function ipcError(reason: unknown): AppError {
  return isAppError(reason)
    ? reason
    : {
        code: 'IPC_ERROR',
        message:
          reason instanceof Error
            ? reason.message
            : typeof reason === 'string'
              ? reason
              : 'Unknown IPC rejection',
        details: reason,
      };
}
export async function invoke<C extends CommandName>(
  name: C,
  args: CommandArgs<C>,
): Promise<CommandResult<C>> {
  try {
    return await tauriInvoke<CommandResult<C>>(name, { ...args });
  } catch (reason) {
    throw ipcError(reason);
  }
}

export const settingsGet = () => invoke('settings_get', {});
export const settingsPatch = (patch: import('@contract/types').SettingsPatch) =>
  invoke('settings_patch', { patch });
export const settingsSet = (settings: import('@contract/types').Settings) =>
  invoke('settings_set', { settings });
export const fontsList = () => invoke('fonts_list', {});
export const txtPrepare = (bookId: string) => invoke('txt_prepare', { bookId });
export const txtPreviewSplit = (args: import('@contract/types').TxtPreviewSplitArgs) =>
  invoke('txt_preview_split', args);
export const txtPrefsSet = (bookId: string, patch: import('@contract/types').TxtPrefsPatch) =>
  invoke('txt_prefs_set', { bookId, patch });
export const bookmarksList = (bookId: string) => invoke('bookmarks_list', { bookId });
export const bookmarkAdd = (args: import('@contract/types').BookmarkAddArgs) =>
  invoke('bookmark_add', args);
export const bookmarkRemove = (bookmarkId: string) => invoke('bookmark_remove', { bookmarkId });

export const bossGetStatus = () => invoke('boss_get_status', {});
export const bossSetShortcut = (shortcut: import('@contract/types').Chord) =>
  invoke('boss_set_shortcut', { shortcut });
export const bossSetEnabled = (enabled: boolean) => invoke('boss_set_enabled', { enabled });
export const dialogPickFolder = () => invoke('dialog_pick_folder', {});
export const librarySetFolder = (path: string | null, moveFiles: boolean) =>
  invoke('library_set_folder', { path, moveFiles });
