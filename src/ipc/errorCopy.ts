import type { ErrorCode } from '@contract/types';
import { isAppError } from './commands';

/**
 * User-facing copy for every ErrorCode (#10). The contract's `message` is English for logs only;
 * the UI never shows it. Unknown rejections (a plain Error from the UI itself) get the generic copy.
 */
const COPY: Record<ErrorCode, string> = {
  INVALID_ARGUMENT: 'Something went wrong. Please try again.',
  INTERNAL: 'Something went wrong. Please try again.',
  NOT_IMPLEMENTED: 'This is not available in this version.',
  IPC_ERROR: 'The app did not respond. Please try again.',
  IO_ERROR: 'A file could not be read or written.',
  DB_ERROR: 'Your library could not be updated. Please try again.',
  DB_VERSION_UNSUPPORTED: 'This library was created by a newer version of the app.',
  WINDOW_OP_FAILED: 'The window could not be changed.',
  SETTINGS_INVALID: 'That setting could not be saved.',
  SETTINGS_MANAGED_KEY: 'That setting is managed elsewhere.',
  BOOK_NOT_FOUND: 'This book is no longer in your library.',
  BOOK_FILE_MISSING: 'The book file is missing. It may have been moved or deleted.',
  BOOK_DRM_PROTECTED: "This book is DRM-protected and can't be opened",
  BOOK_FIXED_LAYOUT: "Fixed-layout books aren't supported yet",
  EPUB_INVALID: 'This book could not be read. The file may be damaged.',
  IMPORT_EMPTY_FILE: 'The file is empty.',
  LIBRARY_FOLDER_INVALID: 'The library folder is not available.',
  TXT_DECODE_FAILED: 'The text could not be read with this encoding.',
  TXT_REGEX_INVALID: 'The chapter pattern is not valid.',
  BOOKMARK_NOT_FOUND: 'That bookmark no longer exists.',
  SHORTCUT_INVALID: 'That shortcut cannot be used.',
  SHORTCUT_IN_USE: 'That shortcut is used by another app.',
  SHORTCUT_REGISTER_FAILED: 'The shortcut could not be registered.',
};

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** The copy to show for any rejection. */
export function errorCopy(reason: unknown): string {
  return isAppError(reason) ? COPY[reason.code] : GENERIC_ERROR;
}


/** Startup and Settings share the contract's recovery path, without backend log messages. */
export function bossKeyFailureCopy(chord: string, reason: unknown): string {
  return isAppError(reason) && reason.code === 'SHORTCUT_IN_USE'
    ? `Boss key ${chord} is in use by another app. Choose another in Settings › Keyboard.`
    : `Boss key ${chord}: ${errorCopy(reason)} Choose another in Settings › Keyboard.`;
}
