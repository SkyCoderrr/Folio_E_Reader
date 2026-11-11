import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from './commands';
import { listen } from './events';
import { installMocks } from './mocks';
import appInfo from '../../contract/examples/app_info.json';
import kvExample from '../../contract/examples/kv_get.json';
import eventExamples from '../../contract/examples/_events.json';
import type { SettingsPatch } from '@contract/types';
beforeEach(() => {
  vi.stubGlobal('window', { crypto: globalThis.crypto });
});
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});
describe('typed IPC wrapper', () => {
  it('passes the exact name and camelCase args', async () => {
    const spy = vi.fn(() => null);
    mockIPC(spy);
    await invoke('window_set_fullscreen', { fullscreen: true });
    expect(spy).toHaveBeenCalledWith('window_set_fullscreen', { fullscreen: true });
  });
  it('preserves AppError including details', async () => {
    const error = {
      code: 'INVALID_ARGUMENT',
      message: 'bad',
      details: { field: 'key', reason: 'empty' },
    };
    mockIPC(() => {
      throw error;
    });
    await expect(invoke('kv_get', { key: '' })).rejects.toEqual(error);
  });
  it.each(['disconnected', new Error('transport'), { message: 'unknown', code: 'BOGUS' }, null])(
    'maps non-AppError rejection to IPC_ERROR: %s',
    async (error) => {
      mockIPC(() => {
        throw error;
      });
      await expect(invoke('app_info', {})).rejects.toMatchObject({ code: 'IPC_ERROR' });
    },
  );
  it('maps listener registration errors', async () => {
    mockIPC(() => {
      throw 'closed';
    });
    await expect(listen('app://close-requested', () => {})).rejects.toMatchObject({
      code: 'IPC_ERROR',
    });
  });
});
describe('contract mock harness', () => {
  it('returns contract examples and independent result copies', async () => {
    installMocks();
    const info = await invoke('app_info', {});
    expect(info).toEqual(appInfo.result);
    info.profileDir = 'changed';
    expect(await invoke('app_info', {})).toEqual(appInfo.result);
  });
  it('supports KV writes, deletion, missing keys and fixture reads', async () => {
    installMocks();
    await expect(invoke('kv_get', { key: 'new' })).resolves.toBeNull();
    await invoke('kv_set', { key: 'new', value: { x: 1 } });
    await expect(invoke('kv_get', { key: 'new' })).resolves.toEqual({ x: 1 });
    await invoke('kv_set', { key: 'new', value: null });
    await expect(invoke('kv_get', { key: 'new' })).resolves.toBeNull();
  });
  it('deletes seeded contract KV values', async () => {
    installMocks();
    await expect(invoke('kv_get', kvExample.args)).resolves.toEqual(kvExample.result);
    await invoke('kv_set', { ...kvExample.args, value: null });
    await expect(invoke('kv_get', kvExample.args)).resolves.toBeNull();
  });
  it('delivers typed event payloads and unlistens', async () => {
    const mock = installMocks();
    const handler = vi.fn();
    const stop = await listen('window://state-changed', handler);
    mock.emit('window://state-changed');
    expect(handler).toHaveBeenCalledWith(eventExamples['window://state-changed'][0]);
    stop();
    mock.emit('window://state-changed');
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('disposes and reinstalls without retaining KV', async () => {
    const mock = installMocks();
    await invoke('kv_set', { key: 'session', value: 3 });
    mock.dispose();
    installMocks();
    await expect(invoke('kv_get', { key: 'session' })).resolves.toBeNull();
  });
  it('maps asset paths to public test fixtures', () => {
    installMocks();
    expect(convertFileSrc('C:\\test\\book.epub')).toBe('/tests/fixtures/alice.epub');
  });
  it('supports the stable stats query contract', async () => {
    installMocks();
    await expect(
      invoke('stats_query', { fromDay: '2026-01-01', toDay: '2026-01-02' }),
    ).resolves.toMatchObject({ days: expect.any(Array), books: expect.any(Array) });
  });
});
// Compile-time checks for the contract nested merge-patch boundary.
const nestedReset: SettingsPatch = { styleOverrides: { font: { size: null } } };
void nestedReset;
// @ts-expect-error string font sizes are forbidden
const badSize: SettingsPatch = { styleOverrides: { font: { size: 'large' } } };
void badSize;
// @ts-expect-error unknown leaf names are forbidden
const badLeaf: SettingsPatch = { styleOverrides: { font: { unknown: 20 } } };
void badLeaf;
it('uses all four named settings/font wrappers with contract-backed stateful mocks', async () => {
  const { settingsGet, settingsPatch, settingsSet, fontsList } = await import('./commands');
  const getExample = (await import('../../contract/examples/settings_get.json')).default;
  const patchExample = (await import('../../contract/examples/settings_patch.json')).default;
  const setExample = (await import('../../contract/examples/settings_set.json')).default;
  const fontExample = (await import('../../contract/examples/fonts_list.json')).default;
  installMocks();
  expect(await settingsGet()).toEqual(getExample.result);
  expect(await settingsPatch(patchExample.args.patch as SettingsPatch)).toEqual(
    patchExample.result,
  );
  const { settings } = setExample.args;
  expect(await settingsSet(settings as import('@contract/types').Settings)).toEqual(
    setExample.result,
  );
  expect(await settingsGet()).toEqual(setExample.result);
  expect(await fontsList()).toEqual(fontExample.result);
});

it('mocks boss and folder commands with persisted managed settings and change events', async () => {
  const mock = installMocks();
  const changed = vi.fn();
  await listen('settings://changed', changed);
  await invoke('boss_set_shortcut', { shortcut: 'Ctrl+Alt+J' });
  const status = await invoke('boss_set_enabled', { enabled: true });
  expect(status).toMatchObject({ registered: true, shortcut: 'Ctrl+Alt+J' });
  expect(await invoke('boss_get_status', {})).toEqual(status);
  const path = await invoke('dialog_pick_folder', {});
  expect((await invoke('library_set_folder', { path, moveFiles: true })).libraryDir).toBe(path);
  expect((await invoke('settings_get', {})).library.folder).toBe(path);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ cause: 'libraryFolder' }));
  mock.dispose();
});
