use super::*;
use rusqlite::{Connection, params};

fn list(connection: &Connection, id: &str) -> Result<ChaptersReadResult, AppError> {
    let mut statement = connection
        .prepare("SELECT chapter_key FROM chapter_read WHERE book_id=?1 ORDER BY read_at, chapter_key COLLATE BINARY")
        .map_err(db_error)?;
    let chapter_keys = statement
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    Ok(ChaptersReadResult { chapter_keys })
}

impl Database {
    pub fn chapters_read_get(&self, id: &str) -> Result<ChaptersReadResult, AppError> {
        validate_id(id)?;
        self.with(|connection| {
            super::repo::get(connection, self, id)?;
            list(connection, id)
        })
    }

    pub fn chapter_mark_read(
        &self,
        id: &str,
        chapter_key: &str,
    ) -> Result<ChaptersReadResult, AppError> {
        validate_id(id)?;
        if chapter_key.is_empty() || chapter_key.len() > 512 {
            return Err(invalid("chapterKey", "Expected 1 to 512 UTF-8 bytes"));
        }
        self.with(|connection| {
            let transaction = connection.transaction().map_err(db_error)?;
            super::repo::get(&transaction, self, id)?;
            transaction
                .execute(
                    "INSERT INTO chapter_read(book_id,chapter_key,read_at) VALUES (?1,?2,?3) ON CONFLICT(book_id,chapter_key) DO NOTHING",
                    params![id, chapter_key, now()],
                )
                .map_err(db_error)?;
            let result = list(&transaction, id)?;
            transaction.commit().map_err(db_error)?;
            Ok(result)
        })
    }
}
