# Commands, UI → backend (contract v0.8.0)

Types are in [`types.ts`](types.ts) (TS) and [`rust-types.md`](rust-types.md) (Rust). Errors are in [`errors.md`](errors.md), events in [`events.md`](events.md). Every M0–M8 command has an example file `examples/<command>.json` (`{ "args": …, "result": … }`) that the UI's IPC mock harness and Codex's contract tests both use. The inline examples below are identical to those files.

**Status:** **stable** = implement as written. **provisional** = fully specified but may change after spike M0.6 / ADR-003. **temporary** = will be removed (with a version bump) after the milestone noted. **draft** = signature and intent only; finalized (minor version bump) before its milestone starts. Do not build against a draft.

## Index

| Command | M | Status | Chunk | Stories |
| --- | --- | --- | --- | --- |
| `app_info` | M0 | stable | M0.1, M0.2 | §12.5 |
| `app_quit` | M0 | stable | M0.6 | NAV-01 |
| `window_get_state` | M0 | stable | M0.6 | WIN-06 |
| `window_minimize` | M0 | stable | M0.6 | WIN-06 |
| `window_toggle_maximize` | M0 | stable | M0.6 | WIN-06, WIN-07 |
| `window_start_drag` | M0 | stable | M0.6 | WIN-07 |
| `window_start_resize` | M0 | provisional | M0.6 | WIN-07 |
| `window_set_caption_rects` | M0 | provisional | M0.6 | WIN-07 |
| `window_set_fullscreen` | M1 | stable | M1.6 | KB-06 |
| `kv_get` | M1 | temporary (until M3.5b) | M1.5a | NAV-01 |
| `kv_set` | M1 | temporary (until M3.5b) | M1.5a | NAV-01 |
| `settings_get` | M2 | stable | M2.1a | RS-*, UI-04 |
| `settings_patch` | M2 | stable | M2.1a | RS-10 |
| `settings_set` | M2 | stable | M2.1a | — |
| `fonts_list` | M2 | stable | M2.3a | RS-03 |
| `dialog_pick_books` | M3 | stable | M3.3 | LIB-02 |
| `library_import` | M3 | stable | M3.2 | LIB-01…03 |
| `library_list` | M3 | stable | M3.4 | LIB-04…07 |
| `book_get` | M3 | stable | M3.4 | LIB-04 |
| `library_remove` | M3 | stable | M3.4 | LIB-08 |
| `book_open` | M3 | stable | M3.5a/b | LIB-09, FMT-01 |
| `position_get` | M3 | stable | M3.5a | NAV-01 |
| `position_save` | M3 | stable | M3.5a | NAV-01, ST-01 |
| `txt_prepare` | M4 | stable | M4.2 | FMT-04…07 |
| `txt_preview_split` | M4 | stable | M4.2 | FMT-08 |
| `txt_prefs_set` | M4 | stable | M4.5 | FMT-05, FMT-08 |
| `chapters_read_get` | M5 | stable | v1 feedback | TOC read memory |
| `chapter_mark_read` | M5 | stable | v1 feedback | TOC read memory |
| `bookmarks_list` | M5 | stable | M5.3a | NAV-05 |
| `bookmark_add` | M5 | stable | M5.3a | NAV-04 |
| `bookmark_remove` | M5 | stable | M5.3a | NAV-04, NAV-05 |
| `boss_get_status` | M7 | stable | M7.2 | WIN-03 |
| `boss_set_shortcut` | M7 | stable | M7.2 | WIN-04 |
| `boss_set_enabled` | M7 | stable | M7.2 | WIN-01, WIN-03 |
| `dialog_pick_folder` | M7 | stable | M7.3 | LIB-03 |
| `library_set_folder` | M7 | stable | M7.3 | LIB-03, R16 |
| `stats_session_save` | M8 | stable | M8.1a | ST-02 |
| `stats_query` | M8 | stable | M8.1a | ST-03…05 |
| `book_set_total_chars` | M8 | stable | M8.1b | ST-01, ST-05 |

Count: M0 8 · M1 3 · M2 4 · M3 8 · M4 3 · M5 5 · M7 5 · M8 3 = **39**.

## General rules

1. **Invocation.** The UI calls `invoke(name, args)` from `@tauri-apps/api/core`, only through the typed wrapper in `src/ipc/` built on `Commands` in `types.ts`. `args` is always an object (`{}` when there are no args) with camelCase keys. Rust command parameters are the same names in snake_case (Tauri converts them). See rust-types.md › Command parameters.
2. **Results.** These are exactly the `result` types in `Commands`. `null` results are `Result<(), AppError>` in Rust.
3. **Errors.** A command rejects with an `AppError`. A rejected command has no side effects unless its section says otherwise (errors.md).
4. **Validation patterns.** `bookId` `^[0-9a-f]{32}$`. `jobId` `^[A-Za-z0-9_-]{1,64}$`. Paths are absolute (drive `X:\` or UNC `\\`). Integers are safe JSON integers (README bounds, plus narrower field ranges). Paths require a drive root or UNC server and share; device paths and NUL are rejected. Any violation → `INVALID_ARGUMENT` with `details { field, reason }`.
5. **Ordering.** Separate `invoke` calls may run concurrently in Rust, so the UI keeps **at most one write in flight per resource**: one settings write at a time; one `position_save` per book at a time (while one is in flight, keep only the newest pending locator). Rust serializes DB and settings writes internally. One library mutation queue/lock spans each complete per-book import pipeline, the entire `library_remove` batch and `library_set_folder`. `book_open`, `book_get` and `library_list` take consistent snapshots; open bookkeeping/lazy prefs creation coordinate with removal. Never hold the lock awaiting UI event handling. DB-backed command precedence is argument validation → DB availability/version gate → row lookup → file/restriction checks → transactional updates; the common gate adds `DB_ERROR` / `DB_VERSION_UNSUPPORTED` to all DB-backed commands, including drafts.
6. **Tauri JS APIs the UI may use:** `invoke` and `convertFileSrc` (`@tauri-apps/api/core`); `listen`, `once` and unlisten (`@tauri-apps/api/event`); `getCurrentWebview().onDragDropEvent` (`@tauri-apps/api/webview`). Nothing else: no `@tauri-apps/api/window`, and no `@tauri-apps/plugin-*` JS packages. Window control, dialogs, settings and files all go through this contract, so the mechanism behind them can change without UI changes.
7. **Durable state** lives only behind these commands. The UI never uses `localStorage`, `sessionStorage` or IndexedDB for anything that must survive a restart.

## How the UI gets book bytes (PRD §10.5)

No command returns file contents. Commands return **absolute paths**, and the webview loads them through the Tauri **asset protocol**:

- EPUB: `fetch(convertFileSrc(book.filePath))` → `Blob` → `new File([blob], book.fileName)` → foliate-js `makeBook(file)`.
- Covers: `<img src={convertFileSrc(book.coverPath)}>`.
- TXT sections (M4): each `TxtSection.path` (`…\cache\txt\<id>\<paramsHash>\sNNNN.html`) is fetched with `convertFileSrc(path)`, then rendered through a UI-created Blob URL or `srcdoc` in the existing no-scripts sandbox, preserving parent access for CSS/locator/key listeners. Do not navigate the iframe directly to the cross-origin asset URL; `allow-same-origin` preserves that asset origin, not the parent origin.
- **Asset scope (Rust maintains it at runtime):** checked individual library, cover and TXT-cache files. Nothing else: never the profile root, `settings.json` or `library.db`. When `library.folder` changes (M7), the new folder is added at once. The old files may stay allowed until restart. New covers are granted on import; book bytes at book_open after managed-path/restriction checks; generated TXT sections at txt_prepare.
- Generated TXT documents and EPUB Blob sections use equivalent no-scripts sandbox/CSP enforcement; no script permission is added. Keep `http://asset.localhost` unless `use_https_scheme` and CSP are changed together.
- CSP is exactly PRD §10.5 (`asset:` and `http://asset.localhost` in `img-src`, `font-src`, `frame-src`, `connect-src`).
- The dev "open file" entry of M0.3 and M1.6 uses an HTML `<input type="file">` and passes the `File` straight to `makeBook`. No IPC is involved, and such files are never loaded through the asset protocol.
- IPC mocks replace `convertFileSrc` so that paths map to fixture URLs.

## Backend runtime obligations (Codex; not commands, but the UI relies on them)

- **Profile** is resolved first (file-layout.md) and logged. `isTestProfile` ⇔ `E_READER_PROFILE_DIR` is set.
- **Startup order:** resolve profile → logging → single-instance check (key per file-layout.md; a second instance with the same profile un-hides and focuses the first one, emitting `boss://shown { source: "secondInstance" }` if it was hidden, then exits) → load settings using the Rust M0.1 loader (defaults/repairs/migrations) → inspect DB version read-only, then open/migrate when supported (from M3; failure disables DB commands but keeps shell/settings usable) → create the window programmatically → register the boss key if `bossKey.enabled` (from M7) → tray (from M7) → show the window.
- **Main window:** label `main`; default 1280 × 800; minimum 480 × 400 (LM-07); `decorations: false` when the title bar is `custom` (`true` when `native`); native shadow and rounded corners; background `#111214` from creation (no white flash); resizable; `dragDropEnabled: true`; zoom hotkeys disabled. Size, position, maximized state and monitor are restored from `window-state.json`; if the monitor is gone, the window is centred on the primary monitor (WIN-05). Hidden, minimized and fullscreen states are not restored at launch. Disable config-driven auto-creation.
- **Browser accelerator keys disabled in release builds** (WebView2 `AreBrowserAcceleratorKeysEnabled = false`: no F5/Ctrl+R reload, Ctrl+P print, Ctrl+F find, Ctrl+Shift+I devtools), using stable `with_webview` on the main thread and `ICoreWebView2Settings3::put_AreBrowserAcceleratorKeysEnabled(false)`. Pin compatible Tauri/WebView2 COM bindings. Local `keybindings` still require DOM cancellation and IME handling; editing/navigation accelerators may remain and OS-reserved shortcuts are excluded. Debug builds keep devtools; WebView zoom is fixed at 1.
- **WebView2 user-data folder** = `<profile>\webview\` via absolute `WebviewWindowBuilder::data_directory(profileDir.join("webview"))`. Pin logging to `TargetKind::Folder { path: profileDir.join("logs"), ... }` and window-state to `<profile>/window-state.json`. The guarantee covers app-controlled persistence/UDF; shared runtime/Windows maintenance is outside it.
- **No network:** no `http` or `fs` plugin; CSP as in PRD §10.5.

---

## M0: app and window

### `app_info` · M0 · stable
- **Args:** none (`{}`).
- **Returns:** `AppInfo`.
- **Errors:** `INTERNAL`.
- **Availability:** `libraryOffline` reports an unavailable or unsafe configured root. Custom roots are never recreated by import, and their saved setting is preserved. Unsafe/unreadable child entries are skipped, never followed or granted; only checked individual library files receive asset grants.
- **Side effects:** none. `libraryDir` is the resolved path; the folder itself may not exist yet (it is created by the first import).
- **UI:** compare `contractVersion` with `CONTRACT_VERSION` from `types.ts` and log an error if they differ. Use `titleBarMode` (not `settings.window.titleBar`) to decide whether to draw custom caption buttons.

Example (`examples/app_info.json`):
```json
{
  "args": {},
  "result": {
    "appVersion": "0.1.0",
    "contractVersion": "0.8.0",
    "profileDir": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01",
    "libraryDir": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library",
    "libraryOffline": false,
    "isTestProfile": true,
    "isDebugBuild": true,
    "titleBarMode": "custom"
  }
}
```

### `app_quit` · M0 · stable
- **Args:** none. **Returns:** `null`. The promise may never settle, because the process exits.
- **Errors:** never rejects.
- **Side effects:** best-effort saves `window-state.json`, unregisters the global shortcut, closes the DB and flushes logs within the shutdown budget, then exits with code 0. Does not emit `app://close-requested`.
- **UI:** used by the custom close button, `Ctrl+Q` and the reply to `app://close-requested`. Bound flushing (`position_save`, pending settings write) and call it in `finally`, even on flush rejection. Native overlay pointer close uses the event handshake; keyboard/accessibility close uses this UI path. Cleanup is best-effort and errors are logged; it never rejects. Start the same single monotonic 3000 ms deadline on direct quit if one is not already active, stop accepting imports, and cancel/drain only within the remaining budget without blocking the UI thread. Timeout/session end may lose unacknowledged writes; acknowledged writes are the recovery basis.

Example (`examples/app_quit.json`):
```json
{ "args": {}, "result": null }
```

### `window_get_state` · M0 · stable
- **Args:** none. **Returns:** `WindowState`. **Errors:** `INTERNAL`. **Side effects:** none.
- **UI:** call once at startup, then follow `window://state-changed`.

Example (`examples/window_get_state.json`):
```json
{
  "args": {},
  "result": { "maximized": false, "minimized": false, "fullscreen": false, "focused": true, "visible": true, "scaleFactor": 1.5 }
}
```

### `window_minimize` · M0 · stable
- **Args:** none. **Returns:** `null`. **Errors:** `WINDOW_OP_FAILED`.
- **Side effects:** minimizes; emits `window://state-changed`.

Example (`examples/window_minimize.json`):
```json
{ "args": {}, "result": null }
```

### `window_toggle_maximize` · M0 · stable
- **Args:** none. **Returns:** `null`. **Errors:** `WINDOW_OP_FAILED`.
- **Side effects:** maximized → restore, otherwise → maximize. Does nothing while fullscreen. Emits `window://state-changed`.
- **UI:** maximize/restore caption button click (unless ADR-003's mechanism handles the click natively) and title-bar double-click (see `window_start_drag`).

Example (`examples/window_toggle_maximize.json`):
```json
{ "args": {}, "result": null }
```

### `window_start_drag` · M0 · stable
- **Args:** none. **Returns:** `null`. **Errors:** `WINDOW_OP_FAILED`.
- **Side effects:** starts the native window-move loop (the same as dragging a native caption), so Aero Snap, drag-to-top maximize, drag-to-restore from maximized and Win+arrow behaviour are native (WIN-07).
- **UI:** on `mousedown` with `button === 0` on a drag area of the title bar (not on a control): if `event.detail === 2`, call `window_toggle_maximize`; otherwise call `window_start_drag`. If ADR-003 adopts CSS `app-region: drag`, the UI stops calling this and the command stays available.

Example (`examples/window_start_drag.json`):
```json
{ "args": {}, "result": null }
```

### `window_start_resize` · M0 · provisional (ADR-003)
- **Args:** `{ direction: ResizeDirection }`. **Returns:** `null`. **Errors:** `WINDOW_OP_FAILED`.
- **Side effects:** starts the native resize loop for that edge or corner.
- **UI:** used only if ADR-003 decides that the UI must drive edge resizing (because the webview covers the native resize border). In that case the UI draws invisible hit zones, 6 CSS px (Rust/Windows performs physical scaling; do not multiply CSS sizes by `scaleFactor`), at the 4 edges and 4 corners, with resize cursors, and calls this on `mousedown`. Otherwise the UI does not call it.

Example (`examples/window_start_resize.json`):
```json
{ "args": { "direction": "southEast" }, "result": null }
```

### `window_set_caption_rects` · M0 · provisional until ADR-003
- **Args:** `{ rects: CaptionRects | null }`. `Rect` uses unzoomed viewport CSS px with WebView zoom fixed at 1. All coordinates are finite, width/height > 0, rectangles do not overlap and stay within the viewport. Rust maps signed screen coordinates (including negative monitor origins) to client space, accounting for webview/client origin and applying DPI conversion exactly once.
- **Returns:** `null`. **Errors:** `INVALID_ARGUMENT` (invalid geometry), `WINDOW_OP_FAILED`.
- **M0.6 candidate:** a Rust-owned, non-activating native child hit-test overlay above the WebView2 caption region, custom WndProc returning `HTMAXBUTTON` over `CaptionRects.maximize`, plus top-level subclassing as needed. Visual transparency must preserve native hit-testing (a no-paint/null-brush child is a candidate; zero-alpha layered/click-through windows can lose input). Do not depend on Chromium child-window class names. Synthesized Win+Z/Alt keystrokes are forbidden. ADR-003 must verify hover flyout, snapping, clicks, no duplicate native painting, hidden chrome, and 100/150/200% mixed-monitor DPI before promotion.
- **Activation:** Rust owns pointer activation for overlay-covered buttons: minimize once, maximize/restore once, close through `app://close-requested` like native X. `window://caption-state` is painting state only. The UI must not duplicate native pointer activation; retain `window_minimize`, `window_toggle_maximize` and bounded flush → `app_quit` for keyboard/accessibility activation.
- **Invalidation:** null disables caption hit-testing. Rust immediately disables overlays in fullscreen/native-titlebar mode and on webview reload, regardless of stale rectangles. Reset hover/press on capture loss, hide, fullscreen and destruction.
- **UI:** serialize calls (one in flight), sending after mount, resize/layout/DPI changes, chrome show/hide, fullscreen changes and transition completion; send null while hidden. Calls are idempotent. Resend fresh geometry after returning from fullscreen/reload; stale queued calls must not resurrect a disabled overlay.

Example (`examples/window_set_caption_rects.json`):
```json
{
  "args": {
    "rects": {
      "minimize": { "x": 1142, "y": 0, "width": 46, "height": 40 },
      "maximize": { "x": 1188, "y": 0, "width": 46, "height": 40 },
      "close": { "x": 1234, "y": 0, "width": 46, "height": 40 }
    }
  },
  "result": null
}
```

## M1: fullscreen and temporary persistence

### `window_set_fullscreen` · M1 · stable
- **Args:** `{ fullscreen: boolean }`. **Returns:** `null`. **Errors:** `WINDOW_OP_FAILED`.
- **Side effects:** enters or leaves fullscreen (the window covers the taskbar); emits `window://state-changed`. Calling it with the current state is a no-op.
- **UI:** `F11` toggles, and `Esc` leaves fullscreen when no panel is open (KB-06). In fullscreen the top bar shows "Exit full screen" instead of caption buttons, and the UI sends `window_set_caption_rects { rects: null }`.

Example (`examples/window_set_fullscreen.json`):
```json
{ "args": { "fullscreen": true }, "result": null }
```

### `kv_get` · M1 · temporary (removed after M3.5b)
- **Args:** `{ key: string }`, where `key` matches `^[A-Za-z0-9._:-]{1,128}$`.
- **Returns:** the stored JSON value, or `null` if the key is absent.
- **Errors:** `INVALID_ARGUMENT` (bad key), `IO_ERROR`.
- **Side effects:** none. The store is `<profile>\kv.json` (one JSON object). If that file is unparseable, it is renamed to `kv.json.corrupt-<unixMs>` and treated as empty.
- **Purpose:** M1.5b stores locators before the DB exists. After M3.5b the UI uses `position_*`, and `kv_*` are removed from the contract with a minor version bump. KV data is not migrated.

Example (`examples/kv_get.json`):
```json
{
  "args": { "key": "position:dev:a-tale-of-two-cities.epub:812340" },
  "result": {
    "sectionIndex": 5,
    "cfi": "epubcfi(/6/12!/4/2/14/1:118)",
    "charOffset": 2140,
    "globalCharOffset": null,
    "progress": 0.1834,
    "snippet": "It was the best of times, it was"
  }
}
```

### `kv_set` · M1 · temporary (removed after M3.5b)
- **Args:** `{ key: string, value: JsonValue }`. `value` ≤ 64 KiB when serialized. `null` deletes the key.
- **Returns:** `null`. **Errors:** `INVALID_ARGUMENT` (bad key, value too large), `IO_ERROR`.
- **Side effects:** atomic rewrite of `<profile>\kv.json` (`kv.json.tmp` → rename).

Example (`examples/kv_set.json`):
```json
{
  "args": {
    "key": "position:dev:a-tale-of-two-cities.epub:812340",
    "value": {
      "sectionIndex": 5,
      "cfi": "epubcfi(/6/12!/4/2/14/1:118)",
      "charOffset": 2140,
      "globalCharOffset": null,
      "progress": 0.1834,
      "snippet": "It was the best of times, it was"
    }
  },
  "result": null
}
```

## M2: settings and fonts

Behaviour (load, write, merge-patch, managed keys, migration) is in [`settings.md`](settings.md). The full-object examples are long, so they are not repeated here: see `examples/settings_get.json`, `examples/settings_patch.json` and `examples/settings_set.json`.

### `settings_get` · M2 · stable
- **Args:** none. **Returns:** `Settings` (the complete effective object, loaded at startup and held in memory).
- **Errors:** `INTERNAL`. **Side effects:** none.

### `settings_patch` · M2 · stable
- **Args:** `{ patch: SettingsPatch }`, a JSON Merge Patch (RFC 7396). `null` resets a key to its default; arrays replace.
- **Returns:** the new effective `Settings`.
- **Errors:** `SETTINGS_INVALID` (details `issues`), `SETTINGS_MANAGED_KEY` (details `keys`), `IO_ERROR` (the write failed; the in-memory settings are unchanged).
- **Side effects:** an atomic write of `settings.json` if anything changed. **No event.**
- Example `examples/settings_patch.json`: `{ "reader": { "flow": "paged" }, "styleOverrides": { "font": { "size": null } } }` switches to paged flow and removes the only override (`styleOverrides` becomes `{}`).

### `settings_set` · M2 · stable
- **Args:** `{ settings: Settings }` (complete; `version` must be 1). Rust validates the raw JSON body against the schema before typed conversion so invalid bodies return `SETTINGS_INVALID.issues` (settings.md).
- **Returns:** the new effective `Settings` (equal to the input when it is valid).
- **Errors:** as `settings_patch`. Managed keys must equal their current values.
- **Side effects:** replaces all known keys (unknown keys in the file are preserved) with an atomic write. **No event.**

### `fonts_list` · M2 · stable
- **Args:** none. **Returns:** `FontFamily[]`, sorted case-insensitively by `family`.
- **Errors:** `INTERNAL`.
- **Rules:** installed system fonts via `fontdb`, grouped by family. `family` = the English (0x0409) family name (typographic family name ID 16 if present, else ID 1), or the first name if there is no English one. `localizedFamilies` = the other distinct family names. Families starting with `@` (vertical variants) are excluded. `cjk` = the family has glyphs for U+4E00, U+6C34 and U+3002. `weights` = the distinct `usWeightClass` values of upright faces, ascending (italic faces only if the family has no upright face). The result is computed once per process and cached, so fonts installed while the app runs appear after a restart.
- **UI:** may call it once early (idle) and cache it, so FontPicker opens in < 100 ms (M2.3b). CSS always uses `family` (R8).

Example (`examples/fonts_list.json`):
```json
{
  "args": {},
  "result": [
    { "family": "Microsoft YaHei", "localizedFamilies": ["微软雅黑"], "cjk": true, "weights": [300, 400, 700] },
    { "family": "Segoe UI", "localizedFamilies": [], "cjk": false, "weights": [300, 400, 600, 700, 900] },
    { "family": "Sitka Text", "localizedFamilies": [], "cjk": false, "weights": [400, 700] }
  ]
}
```

## M3: library, books, positions

### `dialog_pick_books` · M3 · stable
- **Args:** none. **Returns:** the picked absolute paths, or `[]` if cancelled.
- **Errors:** `INTERNAL`.
- **Side effects:** shows the native Windows Open dialog, modal to the main window, with multi-select and the filter "Books (`*.epub;*.txt`)" (LIB-02). The UI then calls `library_import` with the result.

Example (`examples/dialog_pick_books.json`):
```json
{
  "args": {},
  "result": ["C:\\Users\\dany\\Downloads\\a-tale-of-two-cities.epub", "C:\\Users\\dany\\Downloads\\三体.txt"]
}
```

### `library_import` · M3 · stable
- **Args:** `{ jobId: JobId, paths: AbsPath[] }`. `jobId` is generated by the UI (e.g. `crypto.randomUUID()`) and must not have been used before in this process. `paths` has 1–10000 entries (files and/or folders, from the picker or a drop).
- **Returns:** `null` as soon as the job is queued. Processing continues in the background.
- **Errors (the command):** `INVALID_ARGUMENT` (empty or too many paths, relative path, bad or reused `jobId`). `DB_ERROR` / `DB_VERSION_UNSUPPORTED` at the availability gate before queue acceptance. Problems with individual files never reject the command; they are reported in `import://item`.
- **Events:** `import://item` for each candidate, then `import://done` once (events.md, which also gives ordering and walk rules).
- **Enumeration:** the worker enumerates supplied paths in order, folders depth-first, case-insensitive ordinal names with exact ordinal tie-breaks. Each unresolved supplied path or failed directory enumeration becomes one synthetic failed candidate (`path`, basename `fileName`, `IO_ERROR`), included in total; discovered books still run. Skipped symlinks/junctions generate no item. Fix total before the first event. Reject reuse of any previously accepted jobId, not just active ones.
- **Pipeline for each candidate** (off UI thread; jobs FIFO; complete per-book mutation under the library lock):
  1. Direct files of any extension are candidates (non-EPUB/TXT → unsupported); within folders only EPUB/TXT are candidates, case-insensitively.
  2. Stage source bytes while hashing those **same bytes**; zero bytes → `IMPORT_EMPTY_FILE`. Use a journal-tracked temporary staging file until the id is known, then `<libraryDir>/.<id>.<ext>.part`. The id is the first 32 lowercase BLAKE3 hex chars. Create the library directory lazily. Never hash then separately copy a potentially changed source.
  3. Validate/flush staged bytes. Existing id → duplicate; restore a missing managed copy from staging before reporting it. Originals are never modified/moved; only the original filename is kept.
  4. Metadata from staged bytes. EPUB: zip + quick-xml OPF; first dc:title (else stem), dc:creator values joined with ", " (else null), first dc:language (else null). Unreadable zip, missing container/OPF → `EPUB_INVALID`. Store independent DRM/fixed-layout flags; font-obfuscation exemptions are `http://www.idpf.org/2008/embedding` and `http://ns.adobe.com/pdf/enc#RC`. Global `rendition:layout = pre-paginated` marks fixed layout. Bound ZIP member extraction/total expansion and image dimensions so malformed EPUBs cannot exhaust the worker indefinitely. TXT: stem title stripped of surrounding 《》/【】/[] and trailing 作者：…/by …, trimmed; author from stem (`作者[:：]…`) or first 4 KiB (`作者[:：]\s*(\S{1,40})`), else null; language null until M4.
  5. Cover: EPUB 3 cover-image else EPUB 2 meta name=cover. Write 300 px-wide JPEG quality 85 to `<profile>/library/covers/<id>.jpg`; cover failures are nonfatal (coverPath null).
  6. Publish the staged copy by rename to `<libraryDir>/<id>.<ext>` (lowercase ext), commit books row (`added_at` now, progress 0), then emit added. No added event before commit.
  7. Every failure, including partial staging writes, attempts best-effort cleanup of app-created staging/copy/cover files; keep the primary item error and log cleanup failures. Filesystem and DB are not one atomic transaction. At startup, under the library lock, reconcile interrupted imports using a journal of app-created files; never infer ownership or delete originals from a hash-shaped filename.
- **Completion:** exactly one done for each accepted job while the process remains alive; total = added + duplicates + unsupported.length + failed.length, with contiguous item indices. Later DB failures are item errors, including `DB_VERSION_UNSUPPORTED` if needed; process exit cannot promise completion.

Example (`examples/library_import.json`):
```json
{
  "args": {
    "jobId": "6f1c2b9e-3d4a-4b8f-9a2e-1c7d5e0f3a21",
    "paths": [
      "C:\\Users\\dany\\Downloads\\a-tale-of-two-cities.epub",
      "C:\\Users\\dany\\Downloads\\novels",
      "C:\\Users\\dany\\Downloads\\scan.pdf"
    ]
  },
  "result": null
}
```

### `library_list` · M3 · stable
- **Args:** none. **Returns:** every `BookRecord`, ordered by `addedAt` descending. Sorting, filtering and search are done in the UI (LIB-06, LIB-07).
- **Errors:** `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.
- **Side effects:** none. `fileMissing` and `filePath` are computed against the current library folder on each call.
- **UI:** fetch on startup and each time the Library view is shown. Apply `import://item` books in between. Status rules: **unread** = `lastOpenedAt === null` (shows "New"); **finished** = `progress ≥ 0.995`; otherwise **reading**.

Example (`examples/library_list.json`):
```json
{
  "args": {},
  "result": [
    {
      "id": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
      "format": "epub",
      "title": "A Tale of Two Cities",
      "author": "Charles Dickens",
      "language": "en",
      "fileName": "a-tale-of-two-cities.epub",
      "filePath": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library\\3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d.epub",
      "fileSize": 812340,
      "fileMissing": false,
      "coverPath": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library\\covers\\3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d.jpg",
      "totalChars": null,
      "progress": 0.1834,
      "addedAt": 1794211200000,
      "lastOpenedAt": 1794225600000,
      "finishedAt": null
    },
    {
      "id": "9b1e47c2a0d35f8e6c7b2a1d0e9f8a7b",
      "format": "txt",
      "title": "三体",
      "author": "刘慈欣",
      "language": null,
      "fileName": "三体.txt",
      "filePath": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library\\9b1e47c2a0d35f8e6c7b2a1d0e9f8a7b.txt",
      "fileSize": 1873420,
      "fileMissing": false,
      "coverPath": null,
      "totalChars": null,
      "progress": 0,
      "addedAt": 1794211260000,
      "lastOpenedAt": null,
      "finishedAt": null
    }
  ]
}
```

### `book_get` · M3 · stable
- **Args:** `{ bookId }`. **Returns:** `BookRecord`.
- **Errors:** `INVALID_ARGUMENT`, `BOOK_NOT_FOUND`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`. **Side effects:** none.

Example (`examples/book_get.json`):
```json
{
  "args": { "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d" },
  "result": {
    "id": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
    "format": "epub",
    "title": "A Tale of Two Cities",
    "author": "Charles Dickens",
    "language": "en",
    "fileName": "a-tale-of-two-cities.epub",
    "filePath": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library\\3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d.epub",
    "fileSize": 812340,
    "fileMissing": false,
    "coverPath": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library\\covers\\3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d.jpg",
    "totalChars": null,
    "progress": 0.1834,
    "addedAt": 1794211200000,
    "lastOpenedAt": 1794225600000,
    "finishedAt": null
  }
}
```

### `library_remove` · M3 · stable
- **Args:** `{ bookIds: BookId[] }`, 1–10000 ids. Unknown ids are ignored.
- **Returns:** `LibraryRemoveResult { removedIds, fileErrors }`.
- **Errors:** `INVALID_ARGUMENT` (empty, bad id), `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.
- **Side effects:** all unique existing bookIds in input order, in one batch DB transaction committed once: delete the `books` row (which cascades to `positions`, `bookmarks`, `book_prefs`, `sessions` and `chapter_read`). After the commit, delete `<libraryDir>\<id>.<ext>`, `<profile>\library\covers\<id>.jpg` and `<profile>\cache\txt\<id>\`. Missing files are success. Any copy/cover/cache cleanup failure is listed as one aggregated `FileError {bookId,message}` per affected book; rows stay removed. `removedIds` is unique in input order. Validate persisted `file_rel_path`/`cover_rel_path` against the generated id-based layout before access/deletion; malformed DB paths return `DB_ERROR` before the batch commit and never escape managed roots. Nothing outside the library folder and the profile is ever touched (LIB-08). No events.
- **UI:** confirm first (LIB-08). If the open book is among the ids, close the reader before calling.

Example (`examples/library_remove.json`):
```json
{
  "args": { "bookIds": ["9b1e47c2a0d35f8e6c7b2a1d0e9f8a7b", "00000000000000000000000000000000"] },
  "result": { "removedIds": ["9b1e47c2a0d35f8e6c7b2a1d0e9f8a7b"], "fileErrors": [] }
}
```

### `book_open` · M3 · stable
- **Args:** `{ bookId }`. **Returns:** `BookOpenResult { book, locator, txtPrefs }`.
- **Errors, checked in this order:** `INVALID_ARGUMENT` → `DB_ERROR` / `DB_VERSION_UNSUPPORTED` availability gate → `BOOK_NOT_FOUND` → `BOOK_FILE_MISSING` → EPUB revalidation (`EPUB_INVALID`) → `BOOK_DRM_PROTECTED` → `BOOK_FIXED_LAYOUT` → transactional updates (which can also return `DB_ERROR`).
- **Revalidation:** at least detect size/mtime changes in library copies and reparse changed EPUBs before checking restrictions. Internal `meta_json.restrictions: {drm:boolean,fixedLayout:boolean}` can hold both; check DRM first. Only a successful open updates lastOpenedAt or creates default TXT prefs.
- **Side effects (only on success):** `books.last_opened_at` = now. The returned `book` already contains the new `lastOpenedAt`.
- `locator` = the saved position or `null`. `txtPrefs` = the per-book TXT prefs for TXT books (a row with defaults `{ encoding: "auto", detectedEncoding: null, chapterRegex: null, headingMaxChars: null, paragraphMode: null }` if none is stored) and `null` for EPUB.
- **UI:** EPUB → load the bytes via the asset protocol (above) and restore `locator` (PRD §9.4 order). TXT → `txt_prepare` (M4). Until M4 ships, TXT books are listed but the reader opens EPUB only.

Example (`examples/book_open.json`):
```json
{
  "args": { "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d" },
  "result": {
    "book": {
      "id": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
      "format": "epub",
      "title": "A Tale of Two Cities",
      "author": "Charles Dickens",
      "language": "en",
      "fileName": "a-tale-of-two-cities.epub",
      "filePath": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library\\3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d.epub",
      "fileSize": 812340,
      "fileMissing": false,
      "coverPath": "C:\\Users\\dany\\AppData\\Local\\Temp\\e_reader_test\\run-01\\library\\covers\\3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d.jpg",
      "totalChars": null,
      "progress": 0.1834,
      "addedAt": 1794211200000,
      "lastOpenedAt": 1794240000000,
      "finishedAt": null
    },
    "locator": {
      "sectionIndex": 5,
      "cfi": "epubcfi(/6/12!/4/2/14/1:118)",
      "charOffset": 2140,
      "globalCharOffset": null,
      "progress": 0.1834,
      "snippet": "It was the best of times, it was"
    },
    "txtPrefs": null
  }
}
```

### `position_get` · M3 · stable
- **Args:** `{ bookId }`. **Returns:** `Locator | null`.
- **Errors:** `INVALID_ARGUMENT`, `BOOK_NOT_FOUND`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`. **Side effects:** none.

Example (`examples/position_get.json`):
```json
{
  "args": { "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d" },
  "result": {
    "sectionIndex": 5,
    "cfi": "epubcfi(/6/12!/4/2/14/1:118)",
    "charOffset": 2140,
    "globalCharOffset": null,
    "progress": 0.1834,
    "snippet": "It was the best of times, it was"
  }
}
```

### `position_save` · M3 · stable
- **Args:** `{ bookId, locator: Locator }`. Validation: `sectionIndex`, `charOffset` and `globalCharOffset` are integers ≥ 0; `progress` is finite and in 0..1; all integer values obey safe-integer bounds; `snippet` ≤ 200 Unicode scalars; `cfi` ≤ 4096 Unicode scalars. Raw validation requires every Locator key, including nullable `cfi`/`globalCharOffset`. Offsets use UTF-16 code units.
- **Returns:** `null`.
- **Errors:** `INVALID_ARGUMENT`, `BOOK_NOT_FOUND`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.
- **Side effects, in one transaction:** upsert `positions` (`locator_json` = the locator as serialized by Rust, `updated_at` = now); `books.progress` = `locator.progress`; if `progress ≥ 0.995` and `finished_at` is null, set `finished_at` = now (it is never cleared). No events.
- **UI (NAV-01):** save 1 s after scrolling settles, on mode switch, on book close, on `boss://hidden` and before `app_quit`. At most one save in flight per book.

Example (`examples/position_save.json`):
```json
{
  "args": {
    "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
    "locator": {
      "sectionIndex": 6,
      "cfi": "epubcfi(/6/14!/4/2/8/1:0)",
      "charOffset": 310,
      "globalCharOffset": null,
      "progress": 0.2011,
      "snippet": "The Mail Coach. It was the Dover"
    }
  },
  "result": null
}
```

---

## M4: TXT (stable)

### `txt_prepare` · M4 · stable
`(args: BookIdArgs) → TxtManifest`. Errors: `BOOK_NOT_FOUND`, `BOOK_FILE_MISSING`, `TXT_DECODE_FAILED`, `IO_ERROR`, `INVALID_ARGUMENT` (not a TXT book).
Effective parameters = the per-book `book_prefs`, falling back to `settings.txt`. Decodes (BOM → strict UTF-8 → chardetng → encoding_rs, or the forced encoding), detects paragraphs, splits chapters, and writes `<profile>\cache\txt\<id>\<paramsHash>\manifest.json` and `s0001.html…` unless they are already cached. `paramsHash` = the first 16 hex chars of BLAKE3 over the canonical JSON of `{ encoding, chapterRegex, headingMaxChars, fallbackChunkChars, paragraphMode, generatorVersion }`. Updates `books.total_chars`, `books.language` and `book_prefs.txt_detected_enc`. Section files are plain HTML5 (`<html lang>`, `<meta charset="utf-8">`, an `<h2>` heading, `<p>` paragraphs, no style or script). The UI fetches via `convertFileSrc(section.path)` and renders a Blob URL/srcdoc with parent access in the existing no-scripts sandbox (Book bytes above).


**Args:** `{ bookId }`, a canonical book id for a TXT book. **Result:** `TxtManifest`; `encoding` and `detectedEncoding` are the encoding used (never auto). BOM is removed; CR, LF and CRLF are all recognized as line endings. Other decoded source characters, including CR/LF and heading text, count in UTF-16 offsets and totalChars. `lang` is a heuristic (`zh-Hans`, `zh-Hant`, otherwise `en`). Sections cover the source contiguously, with zero-based indices; preface title is `Preface`, fallback titles are `Part N`. Fallback chunks count UTF-16 units and never split a surrogate pair. HTML contains headings once; paragraphs trim leading/trailing ASCII/full-width spaces, retain at most two blank paragraphs. Auto joins when over half the non-empty lines are hard-wrapped at near-constant widths; CJK joins have no inserted space and Latin joins insert one. A malformed trailing sequence is replaced with U+FFFD. Forced encoding wins over BOM; a matching BOM is removed. GBK is canonicalized to gb18030. Cache generatorVersion = 1; canonical parameter JSON uses lexically sorted keys, compact JSON, UTF-8, and the requested encoding (`auto` included). Cache hits restore metadata; missing sections trigger regeneration. Cache assumes managed book bytes remain immutable. **Additional errors:** `TXT_REGEX_INVALID`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`. No events.

Example (`examples/txt_prepare.json`):
```json
{
  "args": {
    "bookId": "0123456789abcdef0123456789abcdef"
  },
  "result": {
    "bookId": "0123456789abcdef0123456789abcdef",
    "encoding": "utf-8",
    "detectedEncoding": "utf-8",
    "lang": "zh-Hans",
    "totalChars": 7,
    "sections": [
      {
        "index": 0,
        "title": "第一回",
        "path": "C:\\EReaderTest\\cache\\txt\\0123456789abcdef0123456789abcdef\\0123456789abcdef\\s0001.html",
        "startChar": 0,
        "chars": 7
      }
    ]
  }
}
```

### `txt_preview_split` · M4 · stable
`(args: TxtPreviewSplitArgs) → TxtPreviewSplitResult { count, first20 }`. Errors: `TXT_REGEX_INVALID`, `BOOK_NOT_FOUND`, `INVALID_ARGUMENT`. Runs on the decoded text without writing anything. The UI debounces it by 250 ms (FMT-08).


**Args:** `{ bookId, chapterRegex, headingMaxChars }`; regex length 1..1000 Unicode scalars; headingMaxChars integer 4..100. Same multiline matcher, trimmed source lines and heading length rejection as prepare; current per-book encoding is honoured. **Result:** `count` counts matched headings only (excludes preface/fallback); `first20` contains the first at most 20 heading titles. No DB/cache writes or events. **Additional errors:** `BOOK_FILE_MISSING`, `TXT_DECODE_FAILED`, `IO_ERROR`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.

Example (`examples/txt_preview_split.json`):
```json
{
  "args": {
    "bookId": "0123456789abcdef0123456789abcdef",
    "chapterRegex": "^第.+回.*$",
    "headingMaxChars": 40
  },
  "result": {
    "count": 1,
    "first20": [
      "第一回"
    ]
  }
}
```

### `txt_prefs_set` · M4 · stable
`(args: TxtPrefsSetArgs { bookId, patch }) → TxtBookPrefs`. `patch` is a merge patch over `{ encoding, chapterRegex, headingMaxChars, paragraphMode }`; `null` = back to the global setting (`encoding` → `auto`). Errors: `INVALID_ARGUMENT`, `TXT_REGEX_INVALID`, `BOOK_NOT_FOUND`. It does not re-split; the UI calls `txt_prepare` next and restores the position by `globalCharOffset` (FMT-05, FMT-08).


**Args:** `{ bookId, patch }`, object with only encoding/chapterRegex/headingMaxChars/paragraphMode; absent keys unchanged, null clears override, encoding auto clears forced encoding. Bounds match TxtSettings; invalid encoding/mode/type/key rejects INVALID_ARGUMENT. Invalid regex rejects TXT_REGEX_INVALID. **Result:** complete TxtBookPrefs with all nullable keys present; detectedEncoding retains the last preparation result. Stored atomically as one book_prefs update. Does not change cached files, positions or bookmarks; no events. Only TXT books accepted. **Additional errors:** `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.

Example (`examples/txt_prefs_set.json`):
```json
{
  "args": {
    "bookId": "0123456789abcdef0123456789abcdef",
    "patch": {
      "paragraphMode": "blank"
    }
  },
  "result": {
    "encoding": "auto",
    "detectedEncoding": null,
    "chapterRegex": null,
    "headingMaxChars": null,
    "paragraphMode": "blank"
  }
}
```

## M5: bookmarks (stable)

### `chapters_read_get` · M5 · stable

**Args:** `{ bookId }`. **Returns:** `ChaptersReadResult { chapterKeys: string[] }`. Returns the full read-chapter list, empty when none. No writes or events. Both TXT and EPUB accepted, including missing book files. Order: first read timestamp ascending, then binary key ascending for ties. Unknown book rejects `BOOK_NOT_FOUND` with `{ bookId }`. Other errors: `INVALID_ARGUMENT`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`. Keys are stable per TOC entry across reopen and re-layout; the UI owns and documents key construction (lane B).

Example (`examples/chapters_read_get.json`):
```json
{
  "args": {
    "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d"
  },
  "result": {
    "chapterKeys": []
  }
}
```

### `chapter_mark_read` · M5 · stable

**Args:** `{ bookId, chapterKey }`. `chapterKey` is opaque to Rust: non-empty, at most 512 UTF-8 bytes; otherwise `INVALID_ARGUMENT` with field `chapterKey`. No trimming or normalization. **Returns:** `ChaptersReadResult { chapterKeys: string[] }`. Idempotently inserts the key, preserving its original read time if already present, and returns the full updated list. Insert and result snapshot share one transaction. No events. No unmark command in v1. Both TXT and EPUB accepted, including missing book files. Order: first read timestamp ascending, then binary key ascending for ties. Unknown book rejects `BOOK_NOT_FOUND` with `{ bookId }`. Other errors: `INVALID_ARGUMENT`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`. Keys are stable per TOC entry across reopen and re-layout; the UI owns and documents key construction (lane B).

Example (`examples/chapter_mark_read.json`):
```json
{
  "args": {
    "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
    "chapterKey": "s:0#"
  },
  "result": {
    "chapterKeys": [
      "s:0#"
    ]
  }
}
```

### `bookmarks_list` · M5 · stable
`(args: BookIdArgs) → Bookmark[]`, sorted by `progress` ascending, then by `createdAt`. Errors: `BOOK_NOT_FOUND`.


**Args:** `{ bookId }`, canonical book id. **Result:** full Bookmark array, empty when none; nullable keys always present. Ties in progress/createdAt sort by numeric id ascending. EPUB and TXT accepted; missing book files do not prevent bookmark access. No writes or events. **Additional errors:** `INVALID_ARGUMENT`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.

Example (`examples/bookmarks_list.json`):
```json
{
  "args": {
    "bookId": "0123456789abcdef0123456789abcdef"
  },
  "result": [
    {
      "id": "42",
      "bookId": "0123456789abcdef0123456789abcdef",
      "locator": {
        "sectionIndex": 0,
        "cfi": null,
        "charOffset": 0,
        "globalCharOffset": 0,
        "progress": 0,
        "snippet": "第一回"
      },
      "progress": 0,
      "chapterTitle": "第一回",
      "snippet": "第一回",
      "createdAt": 1794268800000
    }
  ]
}
```

### `bookmark_add` · M5 · stable
`(args: BookmarkAddArgs { bookId, locator, chapterTitle, snippet }) → Bookmark`. `progress` = `locator.progress`. `snippet` ≤ 60 chars (else `INVALID_ARGUMENT`). Errors: `INVALID_ARGUMENT`, `BOOK_NOT_FOUND`. Undo of a delete = add it again (it gets a new id).


**Args:** all four keys required, including nullable chapterTitle and snippet. Locator validation is identical to position_save (including required nullable keys, numeric bounds and Unicode scalar limits). chapterTitle is string or null; snippet is string or null, at most 60 Unicode scalars. **Result:** persisted Bookmark; id is a new positive decimal SQLite rowid string, createdAt is current Unix ms, progress mirrors locator.progress. Duplicate anchors allowed. One INSERT; positions and book progress unchanged. No events. **Additional errors:** `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.

Example (`examples/bookmark_add.json`):
```json
{
  "args": {
    "bookId": "0123456789abcdef0123456789abcdef",
    "locator": {
      "sectionIndex": 0,
      "cfi": null,
      "charOffset": 0,
      "globalCharOffset": 0,
      "progress": 0,
      "snippet": "第一回"
    },
    "chapterTitle": "第一回",
    "snippet": "第一回"
  },
  "result": {
    "id": "42",
    "bookId": "0123456789abcdef0123456789abcdef",
    "locator": {
      "sectionIndex": 0,
      "cfi": null,
      "charOffset": 0,
      "globalCharOffset": 0,
      "progress": 0,
      "snippet": "第一回"
    },
    "progress": 0,
    "chapterTitle": "第一回",
    "snippet": "第一回",
    "createdAt": 1794268800000
  }
}
```

### `bookmark_remove` · M5 · stable
`(args: BookmarkRemoveArgs { bookmarkId }) → null`. Errors: `BOOKMARK_NOT_FOUND`.


**Args:** `{ bookmarkId }`, canonical positive decimal SQLite i64 rowid string (no sign or leading zero). Invalid syntax/overflow rejects INVALID_ARGUMENT. **Result:** null after one DELETE. Missing row rejects BOOKMARK_NOT_FOUND with `{ bookmarkId }`. Does not alter positions/book progress; no events. **Additional errors:** `INVALID_ARGUMENT`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`.

Example (`examples/bookmark_remove.json`):
```json
{
  "args": {
    "bookmarkId": "42"
  },
  "result": null
}
```

## M7: boss key, tray, library folder

The R lane can build M7.2 right after M0.1, so the boss-key commands are **stable** now.

### `boss_get_status` · M7 · stable
- **Args:** none. **Returns:** `BossKeyStatus { enabled, shortcut, registered, error }`. **Errors:** `INTERNAL`.
- **UI:** call once at startup (after listeners are attached) and on opening Settings › Keyboard. `enabled && !registered` → WIN-03 toast and banner, using `error`.

Example (`examples/boss_get_status.json`):
```json
{
  "args": {},
  "result": {
    "enabled": false,
    "shortcut": "Ctrl+Alt+B",
    "registered": false,
    "error": null
  }
}
```

### `boss_set_shortcut` · M7 · stable
- **Args:** `{ shortcut: Chord }`. **Returns:** `BossKeyStatus`.
- **Errors:** `SHORTCUT_INVALID` (grammar, boss rule or unsupported/ambiguous Windows token), `SHORTCUT_IN_USE`, `SHORTCUT_REGISTER_FAILED`, `IO_ERROR`, `INTERNAL` (failed rollback).
- **Behaviour (WIN-04):** validate. If `bossKey.enabled`: register the new chord first. On failure, reject; the previous chord stays registered and persisted. On success, unregister the old chord. Then persist `bossKey.shortcut` and emit `settings://changed { cause: "bossKey" }`. If disabled: validate and persist only (no registration). All success/publication and failure/rollback behavior is subject to the common setter rule below. Same chord as now and already registered → no-op, returns the status.

Example (`examples/boss_set_shortcut.json`):
```json
{
  "args": {
    "shortcut": "Ctrl+Alt+R"
  },
  "result": {
    "enabled": false,
    "shortcut": "Ctrl+Alt+R",
    "registered": false,
    "error": null
  }
}
```

### `boss_set_enabled` · M7 · stable
- **Args:** `{ enabled: boolean }`. **Returns:** `BossKeyStatus`.
- **Errors:** `SHORTCUT_INVALID`, `SHORTCUT_IN_USE`, `SHORTCUT_REGISTER_FAILED`, `IO_ERROR`, `INTERNAL` (failed rollback).
- **Behaviour:** `true` → register the current chord. On registration failure, reject; IO/unregister failures follow the common compensating rollback rule below. This is also the "retry" after a startup failure. `false` → unregister. Persist `bossKey.enabled` and emit `settings://changed { cause: "bossKey" }` when the stored value changes. In a test profile this is the only way to turn the boss key on, apart from writing it in `settings.json` by hand.

For both boss setters, publish settings only after registration/unregistration and persistence succeed. On IO/unregister failure attempt compensating rollback of registration and persisted settings. Failed rollback rejects `INTERNAL`, exposes actual `BossKeyStatus` via `boss_get_status`, and may emit `boss://register-failed {shortcut,error}` with `error.code = "INTERNAL"`. Toggle only on `ShortcutState::Pressed` (settings.md §10).

Tray (M7.2, no commands): the icon is always present (even while hidden). Left-click toggles hide/show (`boss://hidden` / `boss://shown` with `source: "tray"`). The menu has **Show/Hide**, **Library** (`tray://open-library`), **Settings** (`tray://open-settings`) and **Quit** (`app://close-requested` flow).

Example (`examples/boss_set_enabled.json`):
```json
{
  "args": {
    "enabled": true
  },
  "result": {
    "enabled": true,
    "shortcut": "Ctrl+Alt+B",
    "registered": true,
    "error": null
  }
}
```

### `dialog_pick_folder` · M7 · stable
- **Args:** `{}`. **Result:** `AbsPath | null` (null if cancelled). A native directory-only picker, modal to the calling main window. Selection alone changes no settings or files and emits no event. **Errors:** `IO_ERROR`, `INTERNAL` if the platform result cannot be represented as a native path.

Example (`examples/dialog_pick_folder.json`):
```json
{
  "args": {},
  "result": "D:\\Books"
}
```

### `library_set_folder` · M7 · stable
- **Args:** `LibrarySetFolderArgs { path, moveFiles }`, both keys required; `path: null` selects the default rule. **Result:** `LibrarySetFolderResult { libraryDir, moved, failed }`; libraryDir is canonical, moved is the successfully moved book count, and failed contains one `FileError { bookId, message }` per failed managed copy.
- **Errors:** `LIBRARY_FOLDER_INVALID` (canonical validation, creation/write-probe failure, or a destination book-name collision), `IO_ERROR` (scope/settings persistence), plus the common DB gate. Validate arguments/path before the DB gate, then read a consistent book snapshot. Apply the same canonical/reparse-aware validator as startup (settings.md), before every asset grant. Reject roots equal to/above profileDir, within cache/covers, malformed/device paths and unsafe recursive reparse entries.
- **Ordering:** stop admitting new imports while draining all accepted import jobs; serialize the entire operation with import/removal/read snapshots. Create and probe the folder, revalidate, then grant recursive asset access. Store library.folder as null for the canonical default, otherwise as the canonical path. A request for the same canonical root and stored value is a no-op (moved 0, failed [], no write/event).
- **Commit and moves:** persist the new settings/root before moving any copies, so persistence failure preserves the old root and files. Folder creation and an unused scope grant may remain after a rejected command. With moveFiles true, preflight rejects existing destination names to avoid overwriting unowned files. Then move each generated `<id>.<ext>` (rename, or copy + sync + delete across volumes); do not touch originals, covers, caches or unrelated files. Per-file failures preserve the source and are returned in failed; missing destination copies show fileMissing at the new root. No-move leaves all source copies in place and fileMissing is derived at the new root. Subsequent imports and reads use the new root immediately.
- **Publication:** once completed, emit `settings://changed { settings, cause: "libraryFolder" }` if the stored folder changed. No UI acknowledgement is awaited while holding the mutation lock. The old asset grant may remain until restart.

Example (`examples/library_set_folder.json`):
```json
{
  "args": {
    "path": "D:\\Books",
    "moveFiles": true
  },
  "result": {
    "libraryDir": "D:\\Books",
    "moved": 2,
    "failed": []
  }
}
```

## M8: stats (stable)

### `stats_session_save` · M8 · stable
- **Args:** `StatsSessionSaveArgs { session }`. All seven keys required: `bookId, startedAt, endedAt, activeMs, charsRead, startProgress, endProgress`. Timestamps are nonnegative Unix ms in years 0001–9999; endedAt > startedAt, duration at most 366 days, activeMs <= elapsed ms. Counts are nonnegative safe integers; progress is finite in 0..1 (backwards reading allowed).
- **Result:** null. **Errors:** `INVALID_ARGUMENT`, `BOOK_NOT_FOUND`, plus the common DB gate. Lookup precedes the drop rule even for a short session.
- **Storage:** atomically split the half-open interval at local calendar midnight using the machine timezone at save time (including DST). Persist local_day; later timezone changes do not reclassify rows. Allocate active ms and characters proportionally to elapsed wall time using cumulative integer floors; the final row receives the remainder. Interpolate progress at boundaries. Drop the entire input when activeMs < 10000; retain shorter fragments of accepted sessions. Repeated saves append (no deduplication); submit each completed session once. No position/progress or open-time mutation.
- **UI:** count visible, active reading under stats.enabled and stats.idleTimeoutSec; exclude jumps larger than one viewport from charsRead. Flush on idle, blur, boss hide and book close.

Example (`examples/stats_session_save.json`):
```json
{
  "args": {
    "session": {
      "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
      "startedAt": 1794268800000,
      "endedAt": 1794269100000,
      "activeMs": 300000,
      "charsRead": 1500,
      "startProgress": 0.1,
      "endProgress": 0.2
    }
  },
  "result": null
}
```

### `stats_query` · M8 · stable
- **Args:** `StatsQueryArgs { fromDay, toDay }`: exact valid local YYYY-MM-DD dates, inclusive, fromDay <= toDay, at most 3660 days.
- **Result:** `StatsQueryResult { days, books, totals }`. Days ascend and include zeros: `{ day, activeMs, chars }`. Books includes every current library book ordered by bookId, including zeros: `{ bookId, title, activeMs, chars, progress, lastReadAt, charsPerMin, finished }`. Counts and lastReadAt (latest fragment end, null without data) use only local_day rows in the range. Progress is current books.progress; finished means finished_at != null (sticky). charsPerMin is null until 300000 active ms in the range; otherwise use the latest 1800000 active ms in that range, proportionally trimming the oldest fragment. Ties order by endedAt then row id, latest first. The UI converts Latin speed by dividing by 5.5 and derives time-left using totalChars and progress. Totals `{ activeMs, chars }` sums days; unsafe aggregate integers reject with `DB_ERROR`.
- **Errors:** `INVALID_ARGUMENT`, plus the common DB gate. Consistent snapshot, no writes.

Example (`examples/stats_query.json`):
```json
{
  "args": {
    "fromDay": "2026-11-10",
    "toDay": "2026-11-11"
  },
  "result": {
    "days": [
      {
        "day": "2026-11-10",
        "activeMs": 300000,
        "chars": 1500
      },
      {
        "day": "2026-11-11",
        "activeMs": 0,
        "chars": 0
      }
    ],
    "books": [
      {
        "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
        "title": "Example book",
        "activeMs": 300000,
        "chars": 1500,
        "progress": 0.2,
        "lastReadAt": 1794269100000,
        "charsPerMin": 300,
        "finished": false
      }
    ],
    "totals": {
      "activeMs": 300000,
      "chars": 1500
    }
  }
}
```

### `book_set_total_chars` · M8 · stable
- **Args:** `BookSetTotalCharsArgs { bookId, totalChars }`; totalChars is a nonnegative safe integer. **Result:** null.
- **Errors:** `INVALID_ARGUMENT`, `BOOK_NOT_FOUND`, plus the common DB gate. Atomically persists books.total_chars (repeatable, no progress change). Used for measured EPUB totals; txt_prepare also fills TXT totals.

Example (`examples/book_set_total_chars.json`):
```json
{
  "args": {
    "bookId": "3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d",
    "totalChars": 15000
  },
  "result": null
}
```
