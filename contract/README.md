# E_Reader contract

**Version: 0.9.0** · Status: amended by Codex as editor for Dany_PM, 2026-11-10 · Source of truth: [PRD v1.0](../docs/PRD.md), [USER_STORIES v1.0](../docs/USER_STORIES.md)

## Purpose

This folder is the **only** interface between the Rust/Tauri backend (Codex) and the React/TS UI (Claude Code) (PRD §4.8, §12.2). It defines every Tauri command, event, error code, the settings model, the persisted file and DB layout, and the source layout. Both lanes build against these files and nothing else. Neither side relies on undocumented behaviour of the other. Where this contract and PRD §10.5 (the seed table) differ, this contract wins. Where it seems to conflict with any other part of the PRD or the stories, stop and ask Dany_PM in the log.

## Ownership and change process

- **Owner: Dany_PM.** Codex and Claude Code never edit `contract/`.
- **Change process:**
  1. An agent that needs a change proposes it in `.agent-logs/conversation.md` (what, why, and which commands, events or types are affected).
  2. Dany_PM edits `contract/`, bumps the version and adds a changelog entry below.
  3. Both lanes adopt the new version and cite it in their status notes ("contract 0.9.0").
- A feature that needs a new command starts only after the command is in the contract (PRD §12.2).

## Versioning

`MAJOR.MINOR.PATCH`, with MAJOR 0 until v1.0 ships.
- **PATCH:** wording and clarifications only; no shape or behaviour change.
- **MINOR:** any change to a name, a shape, a behaviour, an error code or an example, or an addition, including promoting a draft to stable.
- `CONTRACT_VERSION` in `types.ts` and Rust (`AppInfo.contractVersion`) must equal this version. The UI logs an error on mismatch.

## Conventions

| Topic | Rule |
| --- | --- |
| Command names | `snake_case`, `<domain>_<verb>` (`library_import`, `position_save`). |
| Event names | `<domain>://<name>` with `-` between words (`import://item`, `boss://register-failed`). |
| JSON keys | camelCase. Rust: `#[serde(rename_all = "camelCase")]` on every struct. Command args: camelCase keys; Rust params in snake_case. |
| String enums | Exactly the literals in `types.ts` (mostly camelCase; `sans-serif`, `utf-8`, … as written). Error codes are `SCREAMING_SNAKE_CASE`. |
| Nullability | `T \| null` = the key is always present (Rust `Option<T>`, serialized as null). `key?:` only in patch/override types and `AppError.details`. |
| Timestamps | Integer Unix **milliseconds**, UTC (`UnixMs`; Rust `i64`). Local calendar days are `'YYYY-MM-DD'` strings. |
| Ids | Strings: book id = 32 lowercase hex chars (BLAKE3 prefix); bookmark id = decimal rowid string; job id = UI-generated. |
| Paths | Absolute Windows paths as strings. The webview loads them only through `convertFileSrc` (asset protocol). |
| Numbers | Integer IPC values must be safe integers: unsigned 0..9007199254740991; `UnixMs` ±9007199254740991, with narrower field limits still applying. Fractions (`progress`, em, px/s) are finite `f64`. |
| Text units | Locator offsets, `TxtSection.startChar/chars` and `totalChars` count UTF-16 code units. Bounded display strings count Unicode scalars: `A😀` is 3 UTF-16 units but 2 scalars. |
| Errors | One shape, `AppError { code, message, details? }` (errors.md). |
| Platform | Windows 11 only. |

## Files

| File | Contents |
| --- | --- |
| [`commands.md`](commands.md) | Every command: milestone, status, args, result, errors, side effects, events, example. Also backend runtime obligations and how book bytes reach the UI. |
| [`events.md`](events.md) | Every backend → UI event: payload, when, ordering. |
| [`errors.md`](errors.md) | `AppError`, how commands reject, all error codes with `details` shapes. |
| [`settings.md`](settings.md) | Settings behaviour: ownership, load and repair, atomic write, merge-patch, managed keys, migration, built-in presets, default keymap, chord grammar. |
| [`settings.schema.json`](settings.schema.json) | JSON Schema (draft 2020-12) of the complete effective `Settings`. |
| [`settings.defaults.json`](settings.defaults.json) | The full default `Settings` object. |
| [`db-schema.sql`](db-schema.sql) | SQLite schema v3 (`user_version = 3`). |
| [`db-schema.md`](db-schema.md) | DB ownership, contract-type mapping, migration policy. |
| [`file-layout.md`](file-layout.md) | Profile and library folder layout, single instance, test-profile rules, repo layout and lane ownership. |
| [`types.ts`](types.ts) | TS types for everything, plus the `Commands` and `Events` maps. |
| [`rust-types.md`](rust-types.md) | The matching Rust types (serde), equivalence rules, contract-test rules. |
| [`examples/`](examples/) | `<command>.json` = `{ "args", "result" }` for every M0–M5 command. `_events.json` = event name → array of example payloads. Used by the UI IPC mocks and the Rust contract tests. |

## What to build first (milestone map)

Statuses: **stable**, **provisional** (may change after ADR-003), **temporary**, **draft** (do not build yet). Details are in commands.md and events.md.

| M | Commands | Events |
| --- | --- | --- |
| **M0** | `app_info`, `app_quit`, `window_get_state`, `window_minimize`, `window_toggle_maximize`, `window_start_drag`, `window_start_resize`ᵖ, `window_set_caption_rects`ᵖ | `app://close-requested`, `window://state-changed`, `window://caption-state`ᵖ |
| **M1** | `window_set_fullscreen`, `kv_get`ᵗ, `kv_set`ᵗ | — |
| **M2** | `settings_get`, `settings_patch`, `settings_set`, `fonts_list` | `settings://changed` (declared now; first emitted by M7 commands) |
| **M3** | `dialog_pick_books`, `library_import`, `library_list`, `book_get`, `library_remove`, `book_open`, `position_get`, `position_save` | `import://item`, `import://done` |
| M4 | `txt_prepare`, `txt_preview_split`, `txt_prefs_set` | — |
| M5 | `chapters_read_get`, `chapter_mark_read`, `bookmarks_list`, `bookmark_add`, `bookmark_remove` (window commands from M0 become production per ADR-003) | — |
| M7 | `boss_get_status`, `boss_set_shortcut`, `boss_set_enabled` (stable: R lane may start after M0.1), `dialog_pick_folder`ᵈ, `library_set_folder`ᵈ | `boss://hidden`, `boss://shown`, `boss://register-failed`, `tray://open-library`, `tray://open-settings` |
| M8 | `stats_session_save`, `stats_query`, `book_set_total_chars`, `book_set_section_chars` | — |

ᵖ provisional · ᵗ temporary · ᵈ draft. Counts: M0 8, M1 3, M2 4, M3 8 (**23 M0–M3 with examples**), M4 3, M5 3 (**37 fully specified with examples**), M7 5, M8 3 (**37 total**). Events: 11.

## Decisions (where the PRD was silent or ambiguous)

Each is the simplest robust option. Dany_PM can overturn any of them with a version bump.

1. **Book bytes come through the asset protocol, not a command.** Commands return absolute paths (`filePath`, `coverPath`, `TxtSection.path`), and the UI calls `convertFileSrc`. PRD §10.5 said `assetUrl`. Returning paths keeps URL building in one documented UI call and makes the mocks trivial. Asset scope = library folder + `<profile>\cache` + `<profile>\library\covers`.
2. **`book_open` is format-agnostic. TXT decoding is a separate `txt_prepare` (M4).** PRD §10.5 put a TXT manifest inside `book_open`. Keeping them apart makes `book_open` complete in M3, and TXT re-splitting reuses `txt_prepare`.
3. **Rust owns `settings.json`: load-time defaults merge, clamping (repair) and migrations.** Rust needs `bossKey`, `library.folder` and `window.titleBar` at startup, before any UI exists. The UI always receives a complete, valid object; it still clamps input before sending and debounces writes. The profile-aware loader, defaults, repairs and migrations are required in M0.1. M2 adds generic writes and full validation/UI. PRD M2.1b owns UI input clamping, store and debounce only; Rust is the migration authority.
4. **Unsaved appearance edits persist as `styleOverrides`** (a sparse diff over the active preset). PRD §9.2 had no field for them, but RS-04, RS-09 and RS-10 need them saved and shown as "Modified". Reset dot = delete a key; Revert = clear.
5. **`settings_patch` is JSON Merge Patch (RFC 7396):** objects merge, arrays replace, `null` resets to the default. This gives per-action keybinding reset and override removal with one rule.
6. **Commands validate strictly (reject, `SETTINGS_INVALID`); loading from disk is lenient (repair + log).** Hand edits never break startup, and UI bugs surface at once.
7. **Managed keys** (`bossKey.enabled`, `bossKey.shortcut`, `library.folder`) change only through `boss_set_enabled`, `boss_set_shortcut` and `library_set_folder`, because they have side effects. Generic writes that would change them reject with `SETTINGS_MANAGED_KEY`.
8. **`settings://changed` fires only for backend-originated changes** (managed keys). Writes from the UI get the new object as their result, so there is no echo that could fight the 300 ms debounce.
9. **settings.json stores the full effective object** (plus preserved unknown keys). The settings schema version is the field `version` (PRD §9.2 name), i.e. the requested "schemaVersion". It is bumped only for breaking moves, not for added keys.
10. **One chord grammar** for keybindings and the boss key: `Ctrl+`/`Alt+`/`Shift+` in that order + a `KeyboardEvent.code` token, with `KeyX` → `X` and `DigitN` → `N`. This keeps the PRD default `"Ctrl+Alt+B"` canonical while storing physical keys (KB-05), with additional Windows platform validation for the global boss key (settings.md §10).
11. **The action-id list is frozen in the contract** (34 ids; section stepping removed by the owner in 0.2.1). `boss.toggle` is not a keybinding; it is `bossKey.shortcut`. The default keymap is written in contract chord syntax (settings.md §9).
12. **Test profile ⇔ `E_READER_PROFILE_DIR` is set.** Then `library.folder` defaults to `<profile>\library` and `bossKey.enabled` defaults to `false` (honoured if set to true explicitly). The single-instance key is a hash of the canonical profile path; use the `Local\<profile-key>` mutex and bounded current-user handoff channel, retaining identifier `com.dany.ereader` without registering the stock single-instance plugin. A present empty/whitespace/invalid/unwritable or UNC/network override shows a native startup error and exits 2, never falling back to the real profile. Only absence selects the real profile.
13. **Import jobs:** the UI generates `jobId`; `library_import` returns once the job is queued; per-file `import://item` then `import://done`; jobs run FIFO. Inside folders only `.epub`/`.txt` are candidates, and other files are ignored silently. Files given directly with other extensions are reported as `unsupported`. Re-importing a book whose copy is missing restores the copy (R16).
14. **DRM and fixed-layout EPUBs are imported**, then `book_open` rejects with `BOOK_DRM_PROTECTED` / `BOOK_FIXED_LAYOUT` so the UI shows the FMT-01 messages. `BookRecord.fileMissing` is computed on every read (R16), and `book_open` rejects `BOOK_FILE_MISSING`.
15. **The UI uses no Tauri plugin JS APIs and no `@tauri-apps/api/window`.** The file picker (`dialog_pick_books`, `dialog_pick_folder`) and window control (`window_*`) are contract commands, so ADR-003 can change the mechanism without UI changes. Drag-drop uses Tauri's built-in webview drop event.
16. **Quit handshake:** Ordinary OS, tray, Alt+F4 and native overlay close requests emit `app://close-requested`; the UI bounds flushing and calls `app_quit` in `finally`; Rust enforces one monotonic 3000 ms deadline with best-effort cleanup (events.md). Needed for NAV-01 "save on quit".
17. **`boss_get_status` exists alongside `boss://register-failed`,** because a startup registration failure can happen before the UI's listeners are attached. Ordinary command failures reject; failed compensating rollback may also emit `boss://register-failed` with `INTERNAL` and actual state remains queryable.
18. **Every un-hide (boss key, tray, second launch) emits `boss://shown { source }`,** and every hide emits `boss://hidden { source }`, so the UI has one pause and resume path.
19. **Ids are strings everywhere,** including bookmark ids (the SQLite rowid as a decimal string).
20. **Temporary KV** is the file `<profile>\kv.json` (the DB arrives only in M3). `kv_*` are removed after M3.5b and their data is not migrated.
21. **M0.3/M1.6 dev "open file" uses `<input type="file">`** (no IPC). Such files are outside the asset scope and never need it.
22. **Status rules:** unread = `lastOpenedAt` null; finished = `progress ≥ 0.995`; `finishedAt` = the first time it reached that value, never cleared.
23. **Library folder is created lazily** (first import), so startup never creates folders in Documents.
24. **WebView2 user-data folder is `<profile>\webview\`, and browser accelerator keys are off in release builds.** This keeps §9.1 "everything under the profile" true and disables browser-specific shortcuts (no F5 reload, no Ctrl+P print). Local keybindings still require DOM cancellation and IME guards; OS-reserved shortcuts are excluded. The UI never uses web storage for durable state.
25. **Writes are serialized:** the UI keeps at most one settings write and one `position_save` per book in flight. Rust serializes DB/settings writers and complete library mutations, with consistent read snapshots (commands.md).
26. **DB from a newer build** → `DB_VERSION_UNSUPPORTED`. Rust never downgrades, and it backs up `library.db` before migrating.
27. **Window commands that may depend on spike M0.6 are marked provisional** (`window_start_resize`, `window_set_caption_rects`, `window://caption-state`). ADR-003 will promote, change or drop them in a later minor version. The M0.6 candidate is the Rust-owned native child hit-test overlay above the WebView2 caption region returning `HTMAXBUTTON`, plus top-level subclassing as needed; synthesized Win+Z/Alt is forbidden.
28. **Contract files are build inputs, never copies:** Rust `include_str!`s `settings.defaults.json`; the UI imports `types.ts` and reads `examples/`. The only pasted file is `rust-types.md`.
29. **Nullable, not optional:** the PRD §9.4 `Locator` fields `cfi?` and `globalCharOffset?` become `cfi: string | null` and `globalCharOffset: number | null`, with the key always present (the Nullability convention above). One rule on both sides, and Rust validates required nullable keys at the raw argument boundary before deserializing `Option<T>`.

## Changelog

0.8.0 - Batch 2: AppInfo.libraryOffline; unavailable custom roots preserved, safe individual-file library grants. Settings schema remains 1.

0.7.0 - Owner t31u: global chrome.footerProgress (off/percent/chapter/both, default off). Existing settings files default missing keys; settings schema version remains 1.

0.4.0 - M7 folder commands promoted to stable; boss/tray implementation. Existing stable semantics unchanged.

0.3.0 - M4 TXT + M5 bookmarks promoted to stable (no behaviour change for existing commands)

0.2.1 - owner removed ]/[ section stepping (t11u)

| Version | Date | Change |
| --- | --- | --- |
| 0.2.0 | 2026-11-09 | PM accepted review items 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28; item 11 wording corrected. Native child caption overlay is the M0.6 candidate, provisional until ADR-003; no synthesized Win+Z/Alt. Per-profile Local mutex/current-user handoff; validation, storage, import and quit rules reconciled. No new user-facing features; settings/DB schema versions stay 1. |
| 0.1.0 | 2026-11-09 | Contract v0 (M0.0): 37 commands (23 stable/provisional/temporary for M0–M3 with examples, boss key stable for M7, the rest draft), 11 events, 23 error codes, settings schema v1 + defaults, DB schema v1, file layout. Awaiting acknowledgement from Codex and Claude Code. |

0.5.0 - M8 stats commands stable: charsRead input, chars aggregates, rolling speed, metadata, totals and examples. Schema remains v1.

0.6.0 - Read chapters: chapters_read_get and chapter_mark_read; opaque keys, idempotent inserts, schema v2 additive migration and cascade on removal.

### 0.9.0 - 2026-11-12
- Owner-authorised G8/G9: book_open returns file-hash-bound EPUB section/fragment measurements and a per-book stats seed. book_set_section_chars persists complete or partial measurements; DB migration 003 adds the cache. Settings schema remains 1.
