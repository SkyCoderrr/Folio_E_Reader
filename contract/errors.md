# Errors (contract v0.9.0)

## Shape

There is exactly one error shape (PRD §10.5):

```ts
interface AppError {
  code: ErrorCode;     // stable SCREAMING_SNAKE identifier, listed below
  message: string;     // English, for logs only; the UI never shows it as-is
  details?: unknown;   // code-specific data (shapes below); the key is absent when there is none
}
```

Rust: `AppError { code: ErrorCode, message: String, details: Option<serde_json::Value> }` with `details` skipped when `None` (rust-types.md).

## How commands reject

- Every command is `#[tauri::command] … -> Result<T, AppError>`. On `Err`, Tauri serializes the `AppError` and the JS `invoke()` promise **rejects with that object** (not a string, not an `Error`).
- A command that rejects has **no side effects**: nothing is written and no event is emitted. The only exceptions are documented per command (for example, `library_import` reports per-file failures in events, and `library_remove` reports copy/cover/cache cleanup failures in its result). A boss setter whose compensating rollback fails may leave changed OS/persisted state: reject `INTERNAL`, expose actual status through `boss_get_status`, and optionally emit `boss://register-failed` with `INTERNAL`.
- `invoke()` can also reject with a **string** that Tauri generates itself: unknown command, or args that fail to deserialize (wrong type, missing key, unknown nested key under `deny_unknown_fields`; unknown top-level invoke keys are ignored by standard named-parameter dispatch). The UI's wrapper in `src/ipc/` normalizes every rejection:
  - an object with a string `code` that is in `ERROR_CODES` and a string `message` → use it as-is;
  - anything else → `{ code: "IPC_ERROR", message: String(reason) }`.
  Rust never produces `IPC_ERROR`.
- Settings bodies are validated as raw JSON before typed conversion, returning `SETTINGS_INVALID.issues`; required nullable Locator keys are checked at the raw boundary (`INVALID_ARGUMENT`).
- Rust validates args beyond their types (ranges, patterns, ids) and rejects with `INVALID_ARGUMENT` and `details: { field, reason }`.
- Every `Err` is logged by Rust at `warn` (or `error` for `INTERNAL`, `DB_ERROR`, `IO_ERROR`) with the command name.
- Panics inside commands must not escape. They are caught and returned as `INTERNAL`.
- During development, a command from a later milestone may be registered as a stub that rejects with `NOT_IMPLEMENTED`. The UI treats that like any other error.

## Codes

`M` = the first milestone in which the code can occur.

| Code | M | When | `details` |
| --- | --- | --- | --- |
| `INVALID_ARGUMENT` | M0 | Args are well-typed but invalid: bad pattern (book id, key, job id, chord in a non-settings command), out of range, empty list, relative path, reuse of any previously accepted `jobId`, KV value > 64 KiB. | `{ field: string, reason: string }` |
| `INTERNAL` | M0 | Bug or unexpected state (including caught panics). | none, or `{ context: string }` |
| `NOT_IMPLEMENTED` | M0 | The command is a stub from a later milestone. | `{ command: string }` |
| `IPC_ERROR` | M0 | **UI-side only:** a non-AppError rejection from `invoke()` (see above). | none |
| `IO_ERROR` | M0 | A filesystem operation failed (read, write, rename, copy, delete, create dir). | `{ path: string, op: "read" \| "write" \| "rename" \| "copy" \| "delete" \| "mkdir", osCode: number \| null }` |
| `DB_ERROR` | M3 | SQLite failed (locked beyond `busy_timeout`, constraint, corruption). | `{ sqliteCode: number \| null }` |
| `DB_VERSION_UNSUPPORTED` | M3 | `library.db` has `user_version` greater than this build supports (written by a newer build). The DB may be opened read-only for version inspection; no write-capable initialization, mutating pragma or downgrade occurs. Every DB-backed command rejects with this code. | `{ found: number, supported: number }` |
| `WINDOW_OP_FAILED` | M0 | A native window operation failed (minimize, maximize, fullscreen, drag, resize, caption hit-test setup). | `{ op: string }` |
| `SETTINGS_INVALID` | M2 | `settings_patch` or `settings_set` input fails validation (settings.md §5). Nothing is written. | `{ issues: Array<{ path: string, message: string }> }` (path is dotted, e.g. `"styleOverrides.font.size"`, `"presets[2].name"`) |
| `SETTINGS_MANAGED_KEY` | M2 | The patch or set would change `bossKey.enabled`, `bossKey.shortcut` or `library.folder`. | `{ keys: string[] }` (dotted paths) |
| `BOOK_NOT_FOUND` | M3 | No book with that id. | `{ bookId: string }` |
| `BOOK_FILE_MISSING` | M3 | The book's library copy does not exist (moved or deleted outside the app, R16). | `{ bookId: string, path: string }` |
| `BOOK_DRM_PROTECTED` | M3 | `book_open` on an EPUB whose `META-INF/encryption.xml` encrypts content (anything other than font obfuscation). UI copy: "This book is DRM-protected and can't be opened" (FMT-01). | `{ bookId: string }` |
| `BOOK_FIXED_LAYOUT` | M3 | `book_open` on an EPUB whose OPF declares `rendition:layout` = `pre-paginated` globally. UI copy: "Fixed-layout books aren't supported yet" (FMT-01). | `{ bookId: string }` |
| `EPUB_INVALID` | M3 | Import or `book_open` revalidation: EPUB is not a readable zip, or lacks `META-INF/container.xml` or OPF. Import failures use `import://item.error`. | `{ reason: string }` |
| `IMPORT_EMPTY_FILE` | M3 | Import: the file is 0 bytes. Reported in `import://item.error`. | none |
| `LIBRARY_FOLDER_INVALID` | M7 | `library_set_folder`: the path is not absolute, cannot be created or written, is equal to/above profileDir, or equal to/within the profile's `cache\` or `library\covers\` (canonical/reparse-aware validator, settings.md). Device paths, NUL and UNC without server/share are invalid. Startup repairs invalid library.folder to null. | `{ path: string, reason: string }` |
| `TXT_DECODE_FAILED` | M4 | `txt_prepare`: with encoding `auto`, the content looks binary (NUL bytes in the first 8 KiB that a UTF-16 BOM or pattern does not explain). | `{ bookId: string }` |
| `TXT_REGEX_INVALID` | M4 | `txt_preview_split` or `txt_prefs_set`: the regex does not compile with fancy-regex or is > 1000 chars. | `{ message: string, position: number \| null }` |
| `BOOKMARK_NOT_FOUND` | M5 | `bookmark_remove` with an unknown id. | `{ bookmarkId: string }` |
| `SHORTCUT_INVALID` | M7 | `boss_set_shortcut`: the chord does not match the grammar/boss rule or uses unsupported/ambiguous Windows tokens (settings.md §10). | `{ shortcut: string, reason: string }` |
| `SHORTCUT_IN_USE` | M7 | OS hotkey registration failed because another app owns the chord (WIN-03, WIN-04). | `{ shortcut: string }` |
| `SHORTCUT_REGISTER_FAILED` | M7 | OS hotkey registration failed for any other reason. | `{ shortcut: string, osMessage: string }` |

## UI mapping rule

The UI maps `code` to copy (and `details` to interpolations). For codes it has no copy for, it shows a generic "Something went wrong" toast and logs the full `AppError`. Validation errors from commands that back form fields (`SETTINGS_INVALID`, `TXT_REGEX_INVALID`, `SHORTCUT_*`) are shown inline only after the user commits a value (UI-07).

## Adding codes

New codes are a contract change (README › Change process). Codes are never renamed or reused.

DB-backed error precedence: argument validation → DB availability/version gate → row lookup → file/restriction checks → transactional updates. `library_import` applies the gate before accepting a job; later DB failures are item errors. DB migration/open failure keeps the shell/settings usable with DB commands predictably disabled.
