use super::*;
use rusqlite::{OptionalExtension, params};

pub struct NewBook {
    pub id: String,
    pub format: String,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub file_name: String,
    pub file_size: u64,
    pub cover: bool,
    pub metadata: serde_json::Value,
}
const COLUMNS: &str = "id,format,title,author,language,file_name,file_rel_path,file_size,cover_rel_path,total_chars,progress,added_at,last_opened_at,finished_at";
fn row(row: &rusqlite::Row<'_>, db: &Database) -> rusqlite::Result<Result<BookRecord, AppError>> {
    let id: String = row.get(0)?;
    let format: String = row.get(1)?;
    let rel: String = row.get(6)?;
    let cover: Option<String> = row.get(8)?;
    let record = BookRecord {
        id: id.clone(),
        format: if format == "epub" {
            BookFormat::Epub
        } else {
            BookFormat::Txt
        },
        title: row.get(2)?,
        author: row.get(3)?,
        language: row.get(4)?,
        file_name: row.get(5)?,
        file_path: db.library_dir().join(&rel).to_string_lossy().into_owned(),
        file_size: row
            .get::<_, i64>(7)?
            .try_into()
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(7, -1))?,
        file_missing: false,
        cover_path: cover
            .as_ref()
            .map(|p| db.profile.root.join(p).to_string_lossy().into_owned()),
        total_chars: row
            .get::<_, Option<i64>>(9)?
            .map(|v| {
                v.try_into()
                    .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(9, v))
            })
            .transpose()?,
        progress: row.get(10)?,
        added_at: row.get(11)?,
        last_opened_at: row.get(12)?,
        finished_at: row.get(13)?,
    };
    Ok((|| {
        validate_id(&id).map_err(db_error)?;
        if !matches!(format.as_str(), "epub" | "txt")
            || rel != format!("{id}.{format}")
            || cover
                .as_ref()
                .is_some_and(|p| p.replace('\\', "/") != format!("library/covers/{id}.jpg"))
        {
            return Err(db_error("Invalid managed relative path"));
        }
        if record.file_size == 0
            || record.file_size > SAFE_INTEGER
            || record.total_chars.is_some_and(|v| v > SAFE_INTEGER)
            || [
                Some(record.added_at),
                record.last_opened_at,
                record.finished_at,
            ]
            .into_iter()
            .flatten()
            .any(|v| v.unsigned_abs() > SAFE_INTEGER)
            || !record.progress.is_finite()
            || !(0.0..=1.0).contains(&record.progress)
        {
            return Err(db_error("Invalid persisted numeric value"));
        }
        Ok(record)
    })())
}
pub(super) fn get(c: &Connection, db: &Database, id: &str) -> Result<BookRecord, AppError> {
    c.query_row(
        &format!("SELECT {COLUMNS} FROM books WHERE id=?1"),
        [id],
        |r| row(r, db),
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| missing(id))?
}
// Filesystem inspection must never run under the SQLite connection mutex.
fn inspect(db: &Database, mut book: BookRecord) -> BookRecord {
    book.file_missing = db
        .managed_path(std::path::Path::new(&book.file_path))
        .is_err()
        || !std::path::Path::new(&book.file_path).is_file()
        || std::fs::File::open(&book.file_path).is_err();
    if book
        .cover_path
        .as_ref()
        .is_some_and(|p| db.managed_path(std::path::Path::new(p)).is_err())
    {
        book.cover_path = None;
    }
    book
}
impl Database {
    pub fn get(&self, id: &str) -> Result<BookRecord, AppError> {
        validate_id(id)?;
        self.with(|c| get(c, self, id))
            .map(|book| inspect(self, book))
    }
    pub fn list(&self) -> Result<Vec<BookRecord>, AppError> {
        self.with(|c| {
            let mut statement = c
                .prepare(&format!(
                    "SELECT {COLUMNS} FROM books ORDER BY added_at DESC, rowid DESC"
                ))
                .map_err(db_error)?;
            statement
                .query_map([], |r| row(r, self))
                .map_err(db_error)?
                .map(|r| r.map_err(db_error).and_then(|r| r))
                .collect::<Result<Vec<_>, AppError>>()
        })
        .map(|books| books.into_iter().map(|book| inspect(self, book)).collect())
    }
    pub fn insert(&self, book: &NewBook) -> Result<BookRecord, AppError> {
        validate_id(&book.id)?;
        if book.file_size > SAFE_INTEGER {
            return Err(db_error("File too large"));
        }
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            tx.execute("INSERT INTO books (id,format,title,author,language,file_name,file_rel_path,file_size,cover_rel_path,added_at,meta_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", params![book.id, book.format, book.title, book.author, book.language, book.file_name, format!("{}.{}",book.id,book.format), book.file_size as i64, book.cover.then(|| format!("library/covers/{}.jpg",book.id)), now(), book.metadata.to_string()]).map_err(db_error)?;
            let result = get(&tx, self, &book.id)?;
            tx.commit().map_err(db_error)?;
            Ok(result)
        }).map(|book| inspect(self, book))
    }
    pub fn remove(&self, ids: &[String]) -> Result<LibraryRemoveResult, AppError> {
        if ids.is_empty() || ids.len() > 10000 {
            return Err(invalid("bookIds", "Expected 1..10000 ids"));
        }
        for id in ids {
            validate_id(id)?;
        }
        for id in ids {
            self.managed_path(&self.profile.covers.join(format!("{id}.jpg")))?;
            self.managed_path(&self.profile.cache.join("txt").join(id))?;
        }
        let books = self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            let mut books = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                if !seen.insert(id) {
                    continue;
                }
                match get(&tx, self, id) {
                    Ok(book) => {
                        tx.execute("DELETE FROM books WHERE id=?1", [id])
                            .map_err(db_error)?;
                        books.push(book);
                    }
                    Err(e) if e.code == ErrorCode::BookNotFound => {}
                    Err(e) => return Err(e),
                }
            }
            tx.commit().map_err(db_error)?;
            Ok(books)
        })?;
        let mut result = LibraryRemoveResult {
            removed_ids: Vec::new(),
            file_errors: Vec::new(),
        };
        for book in books {
            let mut failures = Vec::new();
            let paths = [
                PathBuf::from(&book.file_path),
                self.profile.covers.join(format!("{}.jpg", book.id)),
                self.profile.cache.join("txt").join(&book.id),
            ];
            for path in paths {
                let remove = self.managed_path(&path).and_then(|_| {
                    let result = if path.is_dir() {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_file(&path)
                    };
                    match result {
                        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(db_error(e)),
                        _ => Ok(()),
                    }
                });
                if let Err(e) = remove {
                    failures.push(e.message);
                }
            }
            if !failures.is_empty() {
                result.file_errors.push(FileError {
                    book_id: book.id.clone(),
                    message: failures.join("; "),
                });
            }
            result.removed_ids.push(book.id);
        }
        Ok(result)
    }
    pub fn open_book(&self, id: &str) -> Result<BookOpenResult, AppError> {
        validate_id(id)?;
        let book = self.get(id)?;
        if book.file_missing {
            return Err(
                AppError::new(ErrorCode::BookFileMissing, "Library copy is missing")
                    .with_details(serde_json::json!({"bookId":id,"path":book.file_path})),
            );
        }
        // Revalidate every EPUB: also detects changes with unchanged size/mtime.
        if book.format == BookFormat::Epub {
            let meta = crate::import::epub_meta::read(std::path::Path::new(&book.file_path))?;
            let error = if meta.drm {
                Some(ErrorCode::BookDrmProtected)
            } else if meta.fixed {
                Some(ErrorCode::BookFixedLayout)
            } else {
                None
            };
            if let Some(code) = error {
                let message = if meta.drm {
                    "This book is DRM-protected and can't be opened"
                } else {
                    "Fixed-layout books aren't supported yet"
                };
                return Err(
                    AppError::new(code, message).with_details(serde_json::json!({"bookId":id}))
                );
            }
        }
        let hash = if book.format == BookFormat::Epub {
            Some(super::epub_chars::file_hash(&book.file_path)?)
        } else {
            None
        };
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            let epub_metrics = hash.map(|hash| super::epub_chars::read(&tx, id, hash)).transpose()?;
            let stats_seed = super::stats::book_seed(&tx, id)?;
            let locator = super::positions::read(&tx, id)?;
            let txt_prefs = if book.format == BookFormat::Txt {
                tx.execute("INSERT OR IGNORE INTO book_prefs(book_id) VALUES (?1)", [id]).map_err(db_error)?;
                let json = tx.query_row("SELECT json_object('encoding',coalesce(txt_encoding,'auto'),'detectedEncoding',txt_detected_enc,'chapterRegex',txt_chapter_regex,'headingMaxChars',txt_heading_max,'paragraphMode',txt_paragraph_mode) FROM book_prefs WHERE book_id=?1", [id], |r| r.get::<_,String>(0)).map_err(db_error)?;
                Some(serde_json::from_str(&json).map_err(db_error)?)
            } else { None };
            tx.execute("UPDATE books SET last_opened_at=?2 WHERE id=?1", params![id,now()]).map_err(db_error)?;
            // Refresh DB fields after parsing: a position save may have completed
            // while the EPUB was being read. Keep the already inspected paths.
            let mut current = get(&tx, self, id)?;
            current.file_missing = book.file_missing;
            current.cover_path = book.cover_path;
            tx.commit().map_err(db_error)?;
            Ok(BookOpenResult { book: current, locator, txt_prefs, epub_metrics, stats_seed })
        })
    }
}
