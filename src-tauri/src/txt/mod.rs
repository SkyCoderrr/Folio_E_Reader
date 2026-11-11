pub mod cache;
pub mod decode;
pub mod html;
pub mod paragraphs;
pub mod split;
use crate::{
    contract::*,
    db::{Database, db_error, invalid},
    storage::io_error,
};
use rusqlite::{OptionalExtension, params};

impl Database {
    pub fn txt_book(&self, id: &str) -> Result<BookRecord, AppError> {
        let book = self.get(id)?;
        if book.format != BookFormat::Txt {
            return Err(invalid("bookId", "Expected a TXT book"));
        }
        Ok(book)
    }
    pub fn txt_prefs(&self, id: &str) -> Result<TxtBookPrefs, AppError> {
        self.txt_book(id)?;
        self.with(|c| {
            let json: Option<String> = c.query_row("SELECT json_object('encoding',coalesce(txt_encoding,'auto'),'detectedEncoding',txt_detected_enc,'chapterRegex',txt_chapter_regex,'headingMaxChars',txt_heading_max,'paragraphMode',txt_paragraph_mode) FROM book_prefs WHERE book_id=?1", [id], |r| r.get(0)).optional().map_err(db_error)?;
            json.map(|json| serde_json::from_str(&json).map_err(db_error)).unwrap_or_else(|| Ok(TxtBookPrefs { encoding: TxtEncoding::Auto, detected_encoding: None, chapter_regex: None, heading_max_chars: None, paragraph_mode: None }))
        })
    }
    pub fn txt_prefs_set(
        &self,
        id: &str,
        patch: serde_json::Value,
    ) -> Result<TxtBookPrefs, AppError> {
        self.txt_book(id)?;
        let object = patch
            .as_object()
            .ok_or_else(|| invalid("patch", "Expected an object"))?;
        let mut prefs = self.txt_prefs(id)?;
        let mut value = serde_json::to_value(&prefs).map_err(db_error)?;
        for (key, v) in object {
            if !matches!(
                key.as_str(),
                "encoding" | "chapterRegex" | "headingMaxChars" | "paragraphMode"
            ) {
                return Err(invalid("patch", "Unknown preference"));
            }
            value[key] = if key == "encoding" && v.is_null() {
                serde_json::json!("auto")
            } else {
                v.clone()
            };
        }
        prefs = serde_json::from_value(value).map_err(|e| invalid("patch", &e.to_string()))?;
        if let Some(pattern) = &prefs.chapter_regex {
            split::regex(pattern, prefs.heading_max_chars.unwrap_or(40))?;
        }
        if prefs
            .heading_max_chars
            .is_some_and(|v| !(4..=100).contains(&v))
        {
            return Err(invalid("headingMaxChars", "Expected 4..100"));
        }
        let enc = if prefs.encoding == TxtEncoding::Auto {
            None
        } else {
            Some(enum_string(prefs.encoding)?)
        };
        let mode = prefs.paragraph_mode.map(enum_string).transpose()?;
        self.with(|c| {
            c.execute("INSERT INTO book_prefs(book_id,txt_encoding,txt_chapter_regex,txt_heading_max,txt_paragraph_mode) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(book_id) DO UPDATE SET txt_encoding=excluded.txt_encoding,txt_chapter_regex=excluded.txt_chapter_regex,txt_heading_max=excluded.txt_heading_max,txt_paragraph_mode=excluded.txt_paragraph_mode", params![id,enc,prefs.chapter_regex,prefs.heading_max_chars,mode]).map_err(db_error)?;
            Ok(())
        })?;
        Ok(prefs)
    }
    pub fn txt_decode(
        &self,
        id: &str,
        prefs: &TxtBookPrefs,
    ) -> Result<(String, TxtEncoding), AppError> {
        let book = self.txt_book(id)?;
        if book.file_missing {
            return Err(
                AppError::new(ErrorCode::BookFileMissing, "Book file missing")
                    .with_details(serde_json::json!({"bookId":id,"path":book.file_path})),
            );
        }
        let bytes = std::fs::read(&book.file_path).map_err(io_error)?;
        decode::decode(&bytes, prefs.encoding, id)
    }
    pub fn txt_preview_split(
        &self,
        id: &str,
        pattern: &str,
        max: u32,
    ) -> Result<TxtPreviewSplitResult, AppError> {
        crate::db::validate_id(id)?;
        split::regex(pattern, max)?;
        // Preview reads preferences without creating a row or writing cache/metadata.
        let prefs = self.with(|c| {
            let enc: Option<Option<String>> = c
                .query_row(
                    "SELECT txt_encoding FROM book_prefs WHERE book_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_error)?;
            Ok(TxtBookPrefs {
                encoding: enc
                    .flatten()
                    .map(|s| serde_json::from_value(serde_json::json!(s)).map_err(db_error))
                    .transpose()?
                    .unwrap_or(TxtEncoding::Auto),
                detected_encoding: None,
                chapter_regex: None,
                heading_max_chars: None,
                paragraph_mode: None,
            })
        })?;
        let (text, _) = self.txt_decode(id, &prefs)?;
        let sections = split::split(&text, pattern, max, 10000)?;
        let headings: Vec<_> = sections
            .into_iter()
            .filter(|s| s.heading_end > s.start)
            .map(|s| s.title)
            .collect();
        Ok(TxtPreviewSplitResult {
            count: headings.len() as u32,
            first20: headings.into_iter().take(20).collect(),
        })
    }
}
pub(crate) fn enum_string<T: serde::Serialize>(value: T) -> Result<String, AppError> {
    Ok(serde_json::to_value(value)
        .map_err(db_error)?
        .as_str()
        .ok_or_else(|| db_error("Invalid enum"))?
        .to_owned())
}
