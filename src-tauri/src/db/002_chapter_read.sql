CREATE TABLE chapter_read (
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_key   TEXT NOT NULL CHECK (length(CAST(chapter_key AS BLOB)) BETWEEN 1 AND 512),
  read_at       INTEGER NOT NULL,
  PRIMARY KEY (book_id, chapter_key)
) STRICT;
CREATE INDEX chapter_read_book_order ON chapter_read(book_id, read_at, chapter_key);

PRAGMA user_version = 2;
