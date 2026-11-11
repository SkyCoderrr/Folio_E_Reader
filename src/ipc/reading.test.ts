import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { installMocks } from './mocks';
import {
  txtPrepare,
  txtPreviewSplit,
  txtPrefsSet,
  bookmarksList,
  bookmarkAdd,
  bookmarkRemove,
} from './commands';
import preview from '../../contract/examples/txt_preview_split.json';
import prepared from '../../contract/examples/txt_prepare.json';
import added from '../../contract/examples/bookmark_add.json';
import type { BookmarkAddArgs } from '@contract/types';
beforeEach(() => {
  vi.stubGlobal('window', { crypto: globalThis.crypto });
  installMocks();
});
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});
it('wraps TXT commands and clears only patched preference overrides', async () => {
  expect(await txtPrepare(prepared.args.bookId)).toEqual(prepared.result);
  expect(await txtPreviewSplit(preview.args)).toEqual(preview.result);
  await txtPrefsSet(prepared.args.bookId, { encoding: 'big5', paragraphMode: 'line' });
  expect(await txtPrefsSet(prepared.args.bookId, { encoding: null })).toMatchObject({
    encoding: 'auto',
    paragraphMode: 'line',
  });
});
it('supports bookmark add/list/remove, numeric ids and independent copies', async () => {
  const args = added.args as BookmarkAddArgs;
  const b = await bookmarkAdd(args);
  expect(b.id).toBe('43');
  expect(await bookmarksList(args.bookId)).toHaveLength(2);
  b.snippet = 'changed';
  expect((await bookmarksList(args.bookId))[1].snippet).toBe(args.snippet);
  await bookmarkRemove(b.id);
  expect(await bookmarksList(args.bookId)).toHaveLength(1);
  await expect(bookmarkRemove(b.id)).rejects.toMatchObject({ code: 'BOOKMARK_NOT_FOUND' });
});
