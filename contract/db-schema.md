# Database (contract v0.9.0)

Schema: [`db-schema.sql`](db-schema.sql) (SQLite schema v3, from PRD §9.3, with CHECK constraints added).

## Ownership

- **Only Rust touches the database.** The file is `<profile>\library.db`, opened by `src-tauri/src/db/` with `rusqlite` (bundled SQLite, which has the JSON1 functions used in the CHECKs).
- **The UI never sees SQL, tables or row shapes.** It sees only the contract types (`BookRecord`, `Locator`, `Bookmark`, `TxtBookPrefs`, …) returned by commands. Columns can be renamed or added without touching the UI, as long as the contract types stay the same.
- The schema is in the contract so that both lanes, and Dany_PM, can reason about what is stored (for example what `library_remove` cascades to).

## Mapping to contract types

| Contract | Source |
| --- | --- |
| `BookRecord.id, format, title, author, language, fileName, fileSize, totalChars, progress, addedAt, lastOpenedAt, finishedAt` | `books` columns of the same meaning |
| `BookRecord.filePath` | `<current library folder>\` + `books.file_rel_path` |
| `BookRecord.coverPath` | `<profile>\` + `books.cover_rel_path`, or null |
| `BookRecord.fileMissing` | `!exists(filePath)`, checked on every read |
| `Locator` (position) | `positions.locator_json` (serde JSON of `Locator`) |
| `ChaptersReadResult.chapterKeys` | `chapter_read.chapter_key`, ordered by `read_at`, then binary key |
| `Bookmark.id` | `bookmarks.id` as a decimal string |
| `TxtBookPrefs.encoding` | `book_prefs.txt_encoding`, null → `"auto"` |
| `TxtBookPrefs.detectedEncoding, chapterRegex, headingMaxChars, paragraphMode` | `book_prefs.txt_detected_enc, txt_chapter_regex, txt_heading_max, txt_paragraph_mode` |

`books.meta_json` is Rust-internal and is not exposed in v1. Keys: `publisher`, `description`, `identifiers` (string[]), `series`, `seriesIndex`, and `restrictions: {drm:boolean,fixedLayout:boolean}` (set at import, revalidated as needed on open; DRM takes precedence). Unknown keys are ignored.

## Rules

- All six tables are `STRICT`; text primary keys explicitly require NOT NULL, locator/meta JSON must be objects, and Rust still validates full Locator structure. `bookmarks.id` is AUTOINCREMENT so automatically allocated ids are never reused; ids remain decimal strings. Calendar validity and `activeMs <= endedAt - startedAt` require command validation.
- Validate persisted file/cover relative paths against the generated id-based layout before access/deletion; malformed paths return `DB_ERROR`, never escape managed roots. Integer IPC values follow README safe-integer bounds; use checked `u64`↔`i64` DB conversions and reject invalid persisted values as `DB_ERROR`. Reading counts/offsets use UTF-16 units, display bounds use Unicode scalars.
- **Connection pragmas (only after version preflight):** `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON` (required for the cascades), `busy_timeout = 5000`.
- **Writes:** every command that writes more than one row uses one transaction. Rust serializes writers (one writer connection).
- **Cascades:** deleting a `books` row deletes its `book_prefs`, `positions`, `bookmarks`, `sessions` and `chapter_read` rows (`library_remove`).

## Migration policy

- The version lives in `PRAGMA user_version`. Schema v2 = `user_version 2`. Immutable numbered migrations are in `src-tauri/src/db/migrations.rs` as an ordered list, separate from the latest `db-schema.sql` snapshot. Migration *N* takes the DB from `N−1` to `N`.
- At startup inspect an existing DB read-only for `user_version` before write-capable initialization or any mutating pragma (including WAL). For an older DB, make `library.db.bak-v<old>` using SQLite backup API (`rusqlite` backup feature), or verify a complete checkpoint with all app connections quiescent before copying the main file. Keep the original backup. Apply each pending migration in its own transaction, setting `user_version` within it. Only the failing step rolls back; completed steps remain. Migration/open failure leaves the shell/settings usable with DB commands disabled (`DB_ERROR`), rather than silently aborting window creation.
- `user_version` > latest (a DB from a newer build) → never open it for writing and never downgrade. Every DB-backed command rejects with `DB_VERSION_UNSUPPORTED`.
- Migrations are **forward-only and additive where possible**. Dropping or repurposing a column needs a new table plus a copy, inside the migration.
- Any schema change is a contract change: update `db-schema.sql` (as the full latest schema), add the migration step to this file, and add a README changelog entry.
- Positions saved through the temporary `kv_*` store (M1) are **not** migrated into `positions` (M3.5a).

## Migration log

| user_version | Contract | Change |
| --- | --- | --- |
| 1 | 0.2.0 | Initial, pre-implementation schema (PRD §9.3) with CHECKs, STRICT tables, explicit non-null keys, object JSON and non-reused bookmark ids. |

| 2 | 0.6.0 | Add chapter_read and ordering index; preserve all existing rows. |

## Read chapters

`ChaptersReadResult.chapterKeys` comes from `chapter_read.chapter_key` ordered by `read_at ASC, chapter_key COLLATE BINARY ASC`. The composite primary key makes marking idempotent, preserving the first read timestamp. Keys are opaque non-empty strings of at most 512 UTF-8 bytes; SQL also checks byte length. The UI owns stable TOC key construction (lane B documents its scheme); Rust never parses or normalizes keys. No unmark in v1.

## Stats (M8)

Stats introduced in schema v1; no stats migration needed in v2. sessions.chars_advanced stores input charsRead and returns as aggregate chars. Save-time local days, proportional splitting, filtering and rolling speed are specified in commands.md. book_set_total_chars updates existing books.total_chars. Query metadata comes from books; time and character aggregates come from sessions.

## EPUB section measurement cache (v3)
Migration 003 adds epub_section_chars, keyed by book_id with removal cascade. file_hash is the full BLAKE3 content digest; metrics_json stores EpubSectionChars. book_open only returns a matching digest. Null sections retain partial success and are retried on the next open. Prior migrations remain immutable. No settings schema change.
