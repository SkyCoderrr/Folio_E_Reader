import { isObject, mergePatch, prune } from '../../state/appearance';
import defaults from '../../../contract/settings.defaults.json';
import { mockIPC, clearMocks, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import type { CommandName, JsonValue, EventName, EventPayload } from '@contract/types';
const modules = import.meta.glob('../../../contract/examples/*.json', {
  eager: true,
  import: 'default',
});
const examples = Object.fromEntries(
  Object.entries(modules)
    .filter(([path]) => !path.endsWith('_events.json'))
    .map(([path, value]) => [path.split('/').pop()!.replace('.json', ''), value]),
) as Partial<Record<CommandName, { args: Record<string, unknown>; result: JsonValue }>>;
const eventExamples = modules['../../../contract/examples/_events.json'] as Record<
  EventName,
  JsonValue[]
>;
export function installMocks() {
  const kv = new Map<string, JsonValue>();
  const initialKv = examples.kv_get;
  if (initialKv) kv.set(String(initialKv.args.key), structuredClone(initialKv.result));
  let settings = structuredClone(examples.settings_get!.result);
  const bookmarks = structuredClone(
    examples.bookmarks_list!.result,
  ) as unknown as import('@contract/types').Bookmark[];
  let bookmarkId = 43;
  const txtPrefs = new Map<string, import('@contract/types').TxtBookPrefs>();
  let nextId = 1;
  let boss: import('@contract/types').BossKeyStatus = {
    ...(settings as unknown as import('@contract/types').Settings).bossKey,
    registered: false,
    error: null,
  };
  const emit = <E extends EventName>(name: E, payload: EventPayload<E>) => {
    for (const [eventId, callbackId] of handlers.get(name) ?? []) {
      (
        window as unknown as {
          __TAURI_INTERNALS__: { runCallback(id: number, value: unknown): void };
        }
      ).__TAURI_INTERNALS__.runCallback(callbackId, {
        event: name,
        id: eventId,
        payload: structuredClone(payload),
      });
    }
  };
  const handlers = new Map<string, Map<number, number>>();
  mockConvertFileSrc('windows');
  const internals = (
    window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } }
  ).__TAURI_INTERNALS__;
  internals.convertFileSrc = (path) =>
    path.toLowerCase().endsWith('.epub')
      ? '/tests/fixtures/alice.epub'
      : '/tests/fixtures/xiyouji-ch1-5-utf8.txt';
  mockIPC((command, raw) => {
    const args = (raw ?? {}) as Record<string, unknown>;
    if (command === 'plugin:event|listen') {
      const id = nextId++;
      const name = String(args.event);
      const group = handlers.get(name) ?? new Map<number, number>();
      group.set(id, args.handler as number);
      handlers.set(name, group);
      return id;
    }
    if (command === 'plugin:event|unlisten') {
      handlers.get(String(args.event))?.delete(args.eventId as number);
      return;
    }
    if (command === 'kv_set') {
      if (args.value === null) kv.delete(String(args.key));
      else kv.set(String(args.key), structuredClone(args.value) as JsonValue);
      return null;
    }
    if (command === 'boss_get_status') return structuredClone(boss);
    if (command === 'boss_set_enabled' || command === 'boss_set_shortcut') {
      boss = {
        ...boss,
        ...(command === 'boss_set_enabled'
          ? { enabled: args.enabled as boolean }
          : { shortcut: args.shortcut as string }),
        error: null,
      };
      boss.registered = boss.enabled;
      const effective = settings as unknown as import('@contract/types').Settings;
      effective.bossKey = { enabled: boss.enabled, shortcut: boss.shortcut };
      emit('settings://changed', { settings: structuredClone(effective), cause: 'bossKey' });
      return structuredClone(boss);
    }
    if (command === 'dialog_pick_folder') return 'C:\\E_Reader Test Library';
    if (command === 'library_set_folder') {
      const effective = settings as unknown as import('@contract/types').Settings;
      effective.library.folder = args.path as string | null;
      const libraryDir =
        effective.library.folder ??
        (examples.app_info!.result as unknown as import('@contract/types').AppInfo).libraryDir;
      emit('settings://changed', { settings: structuredClone(effective), cause: 'libraryFolder' });
      return { libraryDir, moved: 0, failed: [] };
    }
    if (command === 'settings_get') return structuredClone(settings);
    if (command === 'settings_set') {
      settings = structuredClone(args.settings) as JsonValue;
      return structuredClone(settings);
    }
    if (command === 'settings_patch') {
      const updated = mergePatch(settings, args.patch) as Record<string, unknown>;
      const profileDefaults = structuredClone(defaults);
      profileDefaults.bossKey.enabled = false;
      settings = fillDefaults(updated, profileDefaults) as JsonValue;
      (settings as Record<string, unknown>).styleOverrides = prune(
        (updated.styleOverrides ?? {}) as Record<string, unknown>,
      );
      return structuredClone(settings);
    }
    if (command === 'bookmarks_list') {
      return structuredClone(
        bookmarks
          .filter((b) => b.bookId === args.bookId)
          .sort(
            (a, b) =>
              a.progress - b.progress || a.createdAt - b.createdAt || Number(a.id) - Number(b.id),
          ),
      );
    }
    if (command === 'bookmark_add') {
      const locator = args.locator as import('@contract/types').Locator;
      if (typeof args.snippet === 'string' && [...args.snippet].length > 60)
        throw { code: 'INVALID_ARGUMENT', message: 'Snippet too long' };
      const b = {
        ...structuredClone(
          examples.bookmark_add!.result as unknown as import('@contract/types').Bookmark,
        ),
        ...structuredClone(args),
        id: String(bookmarkId++),
        progress: locator.progress,
        createdAt: Date.now(),
      } as import('@contract/types').Bookmark;
      bookmarks.push(b);
      return structuredClone(b);
    }
    if (command === 'bookmark_remove') {
      const index = bookmarks.findIndex((b) => b.id === args.bookmarkId);
      if (index < 0)
        throw {
          code: 'BOOKMARK_NOT_FOUND',
          message: 'Bookmark not found',
          details: { bookmarkId: args.bookmarkId },
        };
      bookmarks.splice(index, 1);
      return null;
    }
    if (command === 'txt_prefs_set') {
      const prefs = txtPrefs.get(String(args.bookId)) ?? {
        encoding: 'auto',
        detectedEncoding: null,
        chapterRegex: null,
        headingMaxChars: null,
        paragraphMode: null,
      };
      const patch = args.patch as Record<string, unknown>;
      const updated = {
        ...prefs,
        ...patch,
        encoding: 'encoding' in patch ? (patch.encoding ?? 'auto') : prefs.encoding,
      } as import('@contract/types').TxtBookPrefs;
      txtPrefs.set(String(args.bookId), updated);
      return structuredClone(updated);
    }
    if (command === 'txt_prepare')
      return { ...structuredClone(examples.txt_prepare!.result as object), bookId: args.bookId };
    if (command === 'kv_get') return structuredClone(kv.get(String(args.key)) ?? null);
    const example = examples[command as CommandName];
    if (!example) throw { code: 'NOT_IMPLEMENTED', message: 'No contract example for ' + command };
    return structuredClone(example.result);
  });
  return {
    emit<E extends EventName>(name: E, payload?: EventPayload<E>) {
      const value = payload === undefined ? eventExamples[name][0] : payload;
      for (const [eventId, callbackId] of handlers.get(name) ?? []) {
        (
          window as unknown as {
            __TAURI_INTERNALS__: { runCallback: (id: number, value: unknown) => void };
          }
        ).__TAURI_INTERNALS__.runCallback(callbackId, {
          event: name,
          id: eventId,
          payload: structuredClone(value),
        });
      }
    },
    dispose() {
      clearMocks();
      handlers.clear();
      kv.clear();
    },
  };
}

function fillDefaults(
  value: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(value);
  for (const [key, item] of Object.entries(fallback)) {
    if (!(key in result)) result[key] = structuredClone(item);
    else if (isObject(item) && isObject(result[key])) result[key] = fillDefaults(result[key], item);
  }
  return result;
}
