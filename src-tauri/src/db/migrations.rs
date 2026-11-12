use super::db_error;
use crate::contract::{AppError, ErrorCode};
use rusqlite::{Connection, OpenFlags, backup::Backup};
use std::{path::Path, time::Duration};

pub const VERSION: i64 = 3;
// Immutable, numbered migration; do not embed the latest contract snapshot here.
const MIGRATIONS: &[&str] = &[
    include_str!("001_initial.sql"),
    include_str!("002_chapter_read.sql"),
    include_str!("003_epub_section_chars.sql"),
];

pub fn open(path: &Path) -> Result<Connection, AppError> {
    let old = if path.exists() {
        let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(db_error)?;
        let old: i64 = source
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(db_error)?;
        if old < 0 {
            return Err(db_error("Negative database version"));
        }
        if old > VERSION {
            return Err(AppError::new(
                ErrorCode::DbVersionUnsupported,
                "Database is from a newer build",
            )
            .with_details(serde_json::json!({"found":old,"supported":VERSION})));
        }
        if old < VERSION {
            let backup = path.with_file_name(format!("library.db.bak-v{old}"));
            if !backup.exists() {
                // Publish a completed SQLite backup, including committed WAL pages.
                let temporary = backup.with_extension(format!("backup-{}", std::process::id()));
                let result = (|| {
                    let mut target = Connection::open(&temporary).map_err(db_error)?;
                    Backup::new(&source, &mut target)
                        .map_err(db_error)?
                        .run_to_completion(128, Duration::from_millis(5), None)
                        .map_err(db_error)?;
                    target.close().map_err(|(_, e)| db_error(e))?;
                    std::fs::rename(&temporary, &backup).map_err(db_error)
                })();
                if result.is_err() {
                    let _ = std::fs::remove_file(temporary);
                }
                result?;
            }
        }
        old
    } else {
        0
    };
    let mut connection = Connection::open(path).map_err(db_error)?;
    connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;").map_err(db_error)?;
    for sql in MIGRATIONS.iter().skip(old as usize) {
        let transaction = connection.transaction().map_err(db_error)?;
        transaction.execute_batch(sql).map_err(db_error)?;
        transaction.commit().map_err(db_error)?;
    }
    Ok(connection)
}
