use super::*;
use rusqlite::params;
impl Database {
    pub fn bookmarks_list(&self, id: &str) -> Result<Vec<Bookmark>, AppError> {
        validate_id(id)?;
        self.with(|c| {
            super::repo::get(c, self, id)?;
            let mut stmt = c.prepare("SELECT id, locator_json, progress, chapter_title, snippet, created_at FROM bookmarks WHERE book_id=?1 ORDER BY progress,created_at,id").map_err(db_error)?;
            let rows = stmt.query_map([id], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,f64>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,i64>(5)?))).map_err(db_error)?;
            rows.map(|r| { let (bid,locator,progress,chapter_title,snippet,created_at) = r.map_err(db_error)?;
                let locator = super::positions::validate(&serde_json::from_str(&locator).map_err(db_error)?).map_err(db_error)?;
                Ok(Bookmark {id:bid.to_string(),book_id:id.into(),locator,progress,chapter_title,snippet,created_at}) }).collect()
        })
    }
    pub fn bookmark_add(
        &self,
        id: &str,
        locator: serde_json::Value,
        chapter_title: Option<String>,
        snippet: Option<String>,
    ) -> Result<Bookmark, AppError> {
        validate_id(id)?;
        let locator = super::positions::validate(&locator)?;
        if snippet.as_ref().is_some_and(|s| s.chars().count() > 60) {
            return Err(invalid("snippet", "Maximum 60 Unicode scalars"));
        }
        self.with(|c| {
            super::repo::get(c, self, id)?;
            let created_at = now();
            c.execute("INSERT INTO bookmarks(book_id,locator_json,progress,chapter_title,snippet,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![id,serde_json::to_string(&locator).map_err(db_error)?,locator.progress,chapter_title,snippet,created_at]).map_err(db_error)?;
            Ok(Bookmark { id:c.last_insert_rowid().to_string(),book_id:id.into(),progress:locator.progress,locator,chapter_title,snippet,created_at })
        })
    }
    pub fn bookmark_remove(&self, id: &str) -> Result<(), AppError> {
        let rowid = id
            .parse::<i64>()
            .ok()
            .filter(|v| *v > 0 && v.to_string() == id)
            .ok_or_else(|| invalid("bookmarkId", "Expected positive canonical decimal rowid"))?;
        self.with(|c| {
            if c.execute("DELETE FROM bookmarks WHERE id=?1", [rowid])
                .map_err(db_error)?
                == 0
            {
                return Err(
                    AppError::new(ErrorCode::BookmarkNotFound, "Bookmark not found")
                        .with_details(serde_json::json!({"bookmarkId":id})),
                );
            }
            Ok(())
        })
    }
}
