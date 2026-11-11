-- E_Reader SQLite schema v1 (contract v0.3.0). Source: PRD §9.3. Owner: Dany_PM.
-- File: <profile>\library.db. Only Rust (src-tauri/src/db/) opens it. See db-schema.md.
--
-- Connection setup after read-only user_version preflight, on each writable connection (not part of the migration):
--   PRAGMA journal_mode = WAL;
--   PRAGMA synchronous = NORMAL;
--   PRAGMA foreign_keys = ON;
--   PRAGMA busy_timeout = 5000;
--
-- Migration 1 = everything below, run in ONE transaction by src-tauri/src/db/migrations.rs
-- when PRAGMA user_version = 0. Conventions: timestamps are INTEGER Unix ms UTC; progress is REAL 0..1;
-- paths are stored relative (books.file_rel_path → library folder, books.cover_rel_path → profile root).

CREATE TABLE books (
  id              TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),  -- BLAKE3 prefix, lowercase hex
  format          TEXT NOT NULL CHECK (format IN ('epub', 'txt')),
  title           TEXT NOT NULL,
  author          TEXT,
  language        TEXT,                                   -- BCP 47, e.g. zh-Hans; null = unknown
  file_name       TEXT NOT NULL,                          -- original file name, for display
  file_rel_path   TEXT NOT NULL UNIQUE,                   -- relative to the library folder: '<id>.epub' | '<id>.txt'
  file_size       INTEGER NOT NULL CHECK (file_size > 0),
  cover_rel_path  TEXT,                                   -- relative to the profile root: 'library\covers\<id>.jpg'
  total_chars     INTEGER CHECK (total_chars IS NULL OR total_chars >= 0),  -- filled lazily
  progress        REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),  -- denormalised for library sort
  added_at        INTEGER NOT NULL,
  last_opened_at  INTEGER,
  finished_at     INTEGER,                                -- first time progress >= 0.995; never cleared
  meta_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta_json) AND json_type(meta_json) = 'object')  -- Rust-internal, see db-schema.md
) STRICT;
CREATE INDEX books_last_opened ON books(last_opened_at DESC);

CREATE TABLE book_prefs (                                 -- TXT per-book overrides (FMT-05, FMT-08); null = use global
  book_id             TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  txt_encoding        TEXT CHECK (txt_encoding IS NULL OR txt_encoding IN
                        ('utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'big5', 'shift_jis', 'euc-kr', 'windows-1252')),  -- null = auto
  txt_detected_enc    TEXT CHECK (txt_detected_enc IS NULL OR txt_detected_enc IN
                        ('utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'big5', 'shift_jis', 'euc-kr', 'windows-1252')),
  txt_chapter_regex   TEXT CHECK (txt_chapter_regex IS NULL OR length(txt_chapter_regex) BETWEEN 1 AND 1000),
  txt_heading_max     INTEGER CHECK (txt_heading_max IS NULL OR txt_heading_max BETWEEN 4 AND 100),
  txt_paragraph_mode  TEXT CHECK (txt_paragraph_mode IS NULL OR txt_paragraph_mode IN ('auto', 'line', 'blank'))
) STRICT;

CREATE TABLE positions (
  book_id       TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator_json  TEXT NOT NULL CHECK (json_valid(locator_json) AND json_type(locator_json) = 'object'),   -- serialized contract Locator
  updated_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE bookmarks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,                    -- exposed to the UI as a decimal string
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator_json  TEXT NOT NULL CHECK (json_valid(locator_json) AND json_type(locator_json) = 'object'),
  progress      REAL NOT NULL CHECK (progress >= 0 AND progress <= 1),
  chapter_title TEXT,
  snippet       TEXT CHECK (snippet IS NULL OR length(snippet) <= 60),
  created_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX bookmarks_book ON bookmarks(book_id, progress);

CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY,
  book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  local_day       TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),  -- local 'YYYY-MM-DD'; sessions crossing midnight are split
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL CHECK (ended_at >= started_at),
  active_ms       INTEGER NOT NULL CHECK (active_ms >= 0),
  chars_advanced  INTEGER NOT NULL CHECK (chars_advanced >= 0),   -- excludes jumps > 1 viewport
  start_progress  REAL NOT NULL CHECK (start_progress >= 0 AND start_progress <= 1),
  end_progress    REAL NOT NULL CHECK (end_progress >= 0 AND end_progress <= 1)
) STRICT;
CREATE INDEX sessions_day ON sessions(local_day);
CREATE INDEX sessions_book ON sessions(book_id);

PRAGMA user_version = 1;
