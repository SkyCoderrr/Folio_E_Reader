use super::*;
use rusqlite::{OptionalExtension, params};

pub(super) fn file_hash(path: &str) -> Result<String, AppError> {
    let file = std::fs::File::open(path).map_err(crate::storage::io_error)?;
    let mut hash = blake3::Hasher::new();
    hash.update_reader(file).map_err(crate::storage::io_error)?;
    Ok(hash.finalize().to_hex().to_string())
}
pub(super) fn read(c: &Connection, id: &str, hash: String) -> Result<EpubSectionChars, AppError> {
    let json: Option<String> = c
        .query_row(
            "SELECT metrics_json FROM epub_section_chars WHERE book_id=?1 AND file_hash=?2",
            params![id, hash],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_error)?;
    json.map(|s| serde_json::from_str(&s).map_err(db_error))
        .unwrap_or_else(|| {
            Ok(EpubSectionChars {
                file_hash: hash,
                section_chars: vec![],
                toc_fragment_offsets: Default::default(),
            })
        })
}
impl Database {
    pub fn book_set_section_chars(
        &self,
        id: &str,
        metrics: EpubSectionChars,
    ) -> Result<(), AppError> {
        validate_id(id)?;
        if metrics.file_hash.len() != 64
            || !metrics
                .file_hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || metrics.section_chars.is_empty()
            || metrics.section_chars.len() > 100_000
            || metrics
                .section_chars
                .iter()
                .flatten()
                .any(|n| *n > SAFE_INTEGER)
            || metrics.toc_fragment_offsets.iter().any(|(href, offset)| {
                href.is_empty() || href.len() > 4096 || *offset > SAFE_INTEGER
            })
        {
            return Err(invalid("metrics", "Invalid EPUB measurements"));
        }
        let total = metrics
            .section_chars
            .iter()
            .flatten()
            .try_fold(0u64, |a, n| a.checked_add(*n))
            .filter(|n| *n <= SAFE_INTEGER)
            .ok_or_else(|| invalid("metrics", "Unsafe total"))?;
        let book = self.get(id)?;
        if book.format != BookFormat::Epub {
            return Err(invalid("bookId", "Expected EPUB"));
        }
        if book.file_missing {
            return Err(AppError::new(
                ErrorCode::BookFileMissing,
                "Book file missing",
            ));
        }
        if file_hash(&book.file_path)? != metrics.file_hash {
            return Err(invalid("metrics.fileHash", "Book content changed"));
        }
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            // Coordinate with deletion even when called outside the command's per-book access guard.
            if !tx.query_row("SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)", [id], |r| r.get::<_,bool>(0)).map_err(db_error)? {
                return Err(missing(id));
            }
            let json = serde_json::to_string(&metrics).map_err(db_error)?;
            tx.execute("INSERT INTO epub_section_chars(book_id,file_hash,metrics_json) VALUES (?1,?2,?3) ON CONFLICT(book_id) DO UPDATE SET file_hash=excluded.file_hash,metrics_json=excluded.metrics_json", params![id, metrics.file_hash, json]).map_err(db_error)?;
            let complete = metrics.section_chars.iter().all(Option::is_some);
            tx.execute("UPDATE books SET total_chars=?2 WHERE id=?1", params![id, complete.then_some(total as i64)]).map_err(db_error)?;
            tx.commit().map_err(db_error)
        })
    }
}
