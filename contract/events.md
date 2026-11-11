# Events, backend → UI (contract v0.8.0)

## Rules

- Events are emitted by Rust with `app.emit(name, payload)` to all webviews (there is one window). The UI listens with `listen()` from `@tauri-apps/api/event`.
- Names are `domain://name` (lowercase, `-` between words). The Rust constants are in rust-types.md › `event`.
- Payloads are camelCase JSON matching `Events` in [`types.ts`](types.ts). Payload-less events carry `null` (Rust emits `()`).
- **The UI attaches every listener at startup, before its first command call.** Events are fire-and-forget. Rust does not buffer or replay them. Durable/window state can also be queried by a command (`window_get_state`, `settings_get`, `boss_get_status`, `library_list`), so a listener that attaches late can catch up on that state. Caption painting state is transient and resets as specified below; close/import events are not replayed.
- Examples of every payload are in [`examples/_events.json`](examples/_events.json) (event name → array of example payloads).
- Status: **stable** = implement as written. **provisional** = may change after spike M0.6 / ADR-003.

| Event | M | Status | Payload |
| --- | --- | --- | --- |
| `app://close-requested` | M0 | stable | `null` |
| `window://state-changed` | M0 | stable | `WindowState` |
| `window://caption-state` | M0 | provisional | `CaptionStatePayload` |
| `settings://changed` | M2 (first emitted in M7) | stable | `SettingsChangedPayload` |
| `import://item` | M3 | stable | `ImportItemPayload` |
| `import://done` | M3 | stable | `ImportDonePayload` |
| `boss://hidden` | M7 | stable | `BossHiddenPayload` |
| `boss://shown` | M7 | stable | `BossShownPayload` |
| `boss://register-failed` | M7 | stable | `BossRegisterFailedPayload` |
| `tray://open-library` | M7 | stable | `null` |
| `tray://open-settings` | M7 | stable | `null` |

---

### `app://close-requested` · M0 · stable
- **When:** ordinary close/quit requests: Alt+F4, taskbar Close window, native X, native overlay custom close, or tray Quit. Direct UI keyboard/accessibility close bounds flushing then calls `app_quit`; `app_quit` itself does not emit this event.
- **Rust:** prevent ordinary close, emit once and start one monotonic **3000 ms** deadline; repeated requests do not reset it. Keep the event loop unblocked, stop accepting imports, cancel/drain work only within the remaining budget, then exit with best-effort window-state/DB/log cleanup. Log cleanup errors; app_quit never rejects. SQLite's 5000 ms busy timeout must not extend the shutdown budget.
- **UI:** bound locator/settings flushing and call `app_quit` in `finally` even if flush rejects.
- Timeout, session end/logoff and forced termination may lose unacknowledged writes; acknowledged writes are the recovery basis. No guaranteed JS flush on forced shutdown and no import completion after process exit.

### `window://state-changed` · M0 · stable
- **Payload:** `WindowState` (the full state, not a diff).
- **When:** whenever any field changes: maximize, restore, minimize, fullscreen enter or exit, focus gained or lost, shown or hidden (boss key, tray), or a monitor/DPI change that changes `scaleFactor`. Plain moves and resizes do not emit it.
- **Use:** maximize vs restore glyph, inactive caption style, the "Exit full screen" button, re-sending caption rects after DPI changes.

### `window://caption-state` · M0 · provisional until ADR-003
- **Payload:** `{ hovered: CaptionButton | null, pressed: CaptionButton | null }`.
- **When:** the M0.6 candidate is a Rust-owned native child hit-test overlay above the WebView2 caption region returning `HTMAXBUTTON` (top-level subclassing as needed); synthesized Win+Z/Alt is forbidden. Provisional until ADR-003 verifies the candidate as specified by `window_set_caption_rects`. The overlay owns pointer activation; this event reports painting state only, never an instruction to invoke a button command. Reset to `{hovered:null,pressed:null}` on capture loss, hide, fullscreen and destruction. With a different ADR mechanism it may never be emitted.

### `settings://changed` · M2 · stable
- **Payload:** `{ settings: Settings, cause: "bossKey" | "libraryFolder" }`. `settings` is the complete new effective object.
- **When:** after Rust persisted a change it made itself: `boss_set_shortcut` / `boss_set_enabled` (cause `bossKey`) or `library_set_folder` (cause `libraryFolder`). It is **never** emitted for `settings_patch` or `settings_set` (no echo; settings.md §5).
- **UI duty:** replace its store's copy with `settings`. Any local edits still waiting in the debounce are re-applied on top, as a patch.

### `import://item` · M3 · stable
- **Payload:** `ImportItemPayload` `{ jobId, index, total, path, fileName, outcome, book, error }`.
- **When:** once per candidate file of a `library_import` job, after that file is fully processed (row committed, copy and cover written), so the book can appear at once (LIB-01).
- `outcome`:
  - `added`: `book` = the new record, `error` = null.
  - `duplicate`: a book with the same content hash exists. `book` = the existing record. If its library copy was missing, Rust re-copied it first (R16), so `book.fileMissing` is false.
  - `unsupported`: a file **given directly** in `paths` whose extension is not `.epub` or `.txt` (case-insensitive). `book` and `error` are null. Non-book files found inside folders are skipped silently and are not candidates.
  - `failed`: `error` = an AppError (`EPUB_INVALID`, `IMPORT_EMPTY_FILE`, `IO_ERROR`, `DB_ERROR`, `DB_VERSION_UNSUPPORTED`, `INTERNAL`). `book` = null.
- **Ordering:** in a job, items arrive with `index` 0, 1, …, `total − 1`, in walk order: the given `paths` in order, each folder walked depth-first with entries sorted by case-insensitive ordinal name with exact ordinal tie-breaks. Enumeration runs in the worker; each unresolved supplied path/failed directory enumeration becomes a synthetic failed candidate (path, basename fileName, IO_ERROR). Successfully discovered books still run. Total includes these failures and is fixed before the first item. Symlinks and junctions are not followed. Jobs run one at a time, first in, first out, so events of two jobs never interleave.
- Events can arrive before the `library_import` promise resolves. The UI created the `jobId`, so it can match them.

### `import://done` · M3 · stable
- **Payload:** `ImportDonePayload` `{ jobId, total, added, duplicates, unsupported: string[] (file names), failed: ImportFailure[] }`.
- **When:** exactly once per accepted job while the process remains alive (no completion promise after exit), after its last `import://item`, including jobs with `total = 0` (for example a folder with no books). `total = added + duplicates + unsupported.length + failed.length`, matching contiguous item indices. Any previously accepted jobId reuse is rejected. This drives the result toast: "Added 3 books · 1 duplicate skipped · 1 unsupported".

### `boss://hidden` · M7 · stable
- **Payload:** `{ source: "bossKey" | "tray" }`.
- **When:** right **after** Rust hid the window natively (`window.hide()`, PRD §10.6), triggered by the boss key or by tray left-click/Show-Hide. The UI is not asked first; hiding must take < 100 ms.
- **UI duty (WIN-01):** stop held-key scrolling, pause auto-scroll and the session timer, save the locator. Show no toast or sound.

### `boss://shown` · M7 · stable
- **Payload:** `{ source: "bossKey" | "tray" | "secondInstance" }`.
- **When:** right after Rust restored a hidden window (`show()` → `unminimize()` → `set_focus()`), by the boss key, the tray, or a second launch with the same profile (WIN-05). Emitted only if the window was hidden.
- **UI duty:** resume timers. The view itself was never unloaded (WIN-02).

### `boss://register-failed` · M7 · stable
- **Payload:** `{ shortcut: Chord, error: AppError }` (`SHORTCUT_IN_USE` or `SHORTCUT_REGISTER_FAILED`; exceptionally `INTERNAL` after failed command rollback).
- **When:** an OS registration attempt failed **outside a command call**, which in v1 means at startup (with `bossKey.enabled = true`). Ordinary failures inside `boss_set_shortcut` / `boss_set_enabled` reject instead; the sole command-failure event exception is failed compensating rollback (`INTERNAL`), with actual status queryable via `boss_get_status`.
- Because this can fire before the UI listens, the UI **also** calls `boss_get_status` once at startup and shows the WIN-03 toast and Settings banner if `enabled && !registered`.

### `tray://open-library` · M7 · stable
- **When:** tray menu › Library. Rust first restores the window if it is hidden (emitting `boss://shown { source: "tray" }`), then emits this. The UI navigates to the Library (saving the locator if a book is open).

### `tray://open-settings` · M7 · stable
- **When:** tray menu › Settings. Same as above, and the UI opens Settings.

---

## Tauri built-in events the UI uses (not part of the `Events` map)

- **File drop** (LIB-01): `getCurrentWebview().onDragDropEvent(cb)` from `@tauri-apps/api/webview` delivers `enter` / `over` / `drop` / `leave` with absolute `paths` on drop. The UI shows the overlay and calls `library_import` with the dropped paths. Codex keeps `dragDropEnabled: true` (the Tauri default) on the main window, which means HTML5 drag and drop inside the page is unavailable. v1 has no reorderable lists, so nothing is lost.
- No other Tauri or plugin events are used by the UI.
