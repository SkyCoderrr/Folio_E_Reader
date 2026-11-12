CREATE TABLE epub_section_chars (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  file_hash TEXT NOT NULL CHECK (length(file_hash) = 64 AND file_hash NOT GLOB '*[^0-9a-f]*'),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json) AND json_type(metrics_json) = 'object')
) STRICT;
PRAGMA user_version = 3;
