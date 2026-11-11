use super::*;
use crate::profile::{canonical_future, within};
use std::{fs, path::Path};
const GENERATOR_VERSION: u32 = 1;
fn safe(db: &Database, path: &Path) -> Result<(), AppError> {
    let resolved = canonical_future(path)?;
    if !within(&resolved, &db.profile.cache) || resolved != path {
        return Err(io_error("TXT cache path redirected"));
    }
    Ok(())
}
pub fn language(text: &str) -> String {
    let mut hans = 0;
    let mut hant = 0;
    let mut chinese = false;
    for c in text.chars() {
        chinese |= ('\u{3400}'..='\u{9fff}').contains(&c);
        match c {
            '这' | '为' | '国' | '书' | '来' | '时' | '说' | '个' | '们' | '会' | '发' | '东'
            | '车' | '长' | '门' | '万' | '与' | '云' | '后' | '里' | '无' | '见' | '风' | '龙'
            | '头' | '学' | '体' | '爱' => hans += 1,
            '這' | '為' | '國' | '書' | '來' | '時' | '說' | '個' | '們' | '會' | '發' | '東'
            | '車' | '長' | '門' | '萬' | '與' | '雲' | '後' | '裡' | '無' | '見' | '風' | '龍'
            | '頭' | '學' | '體' | '愛' => hant += 1,
            _ => {}
        }
    }
    if chinese {
        if hant > hans { "zh-Hant" } else { "zh-Hans" }
    } else {
        "en"
    }
    .into()
}
impl Database {
    pub fn txt_prepare(&self, id: &str, settings: &TxtSettings) -> Result<TxtManifest, AppError> {
        let prefs = self.txt_prefs(id)?;
        let pattern = prefs
            .chapter_regex
            .as_deref()
            .unwrap_or(&settings.chapter_regex);
        let max = prefs
            .heading_max_chars
            .unwrap_or(settings.heading_max_chars);
        let mode = prefs.paragraph_mode.unwrap_or(settings.paragraph_mode);
        // Fixed lexical key order is the canonical parameter JSON, independent of map insertion order.
        let params = serde_json::json!({"chapterRegex":pattern,"encoding":prefs.encoding,"fallbackChunkChars":settings.fallback_chunk_chars,"generatorVersion":GENERATOR_VERSION,"headingMaxChars":max,"paragraphMode":mode});
        let canonical = format!(
            "{{\"chapterRegex\":{},\"encoding\":{},\"fallbackChunkChars\":{},\"generatorVersion\":{},\"headingMaxChars\":{},\"paragraphMode\":{}}}",
            params["chapterRegex"],
            params["encoding"],
            params["fallbackChunkChars"],
            params["generatorVersion"],
            params["headingMaxChars"],
            params["paragraphMode"]
        );
        let hash = blake3::hash(canonical.as_bytes()).to_hex()[..16].to_owned();
        let dir = self.profile.cache.join("txt").join(id).join(hash);
        safe(self, &dir)?;
        let manifest_path = dir.join("manifest.json");
        safe(self, &manifest_path)?;
        if let Ok(bytes) = fs::read(&manifest_path)
            && let Ok(manifest) = serde_json::from_slice::<TxtManifest>(&bytes)
            && manifest.book_id == id
            && manifest.sections.iter().enumerate().all(|(i, s)| {
                s.path == dir.join(format!("s{:04}.html", i + 1)).to_string_lossy()
                    && safe(self, Path::new(&s.path)).is_ok()
                    && Path::new(&s.path).is_file()
            })
        {
            self.txt_book(id).and_then(|b| {
                if b.file_missing {
                    Err(
                        AppError::new(ErrorCode::BookFileMissing, "Book file missing")
                            .with_details(serde_json::json!({"bookId":id,"path":b.file_path})),
                    )
                } else {
                    Ok(b)
                }
            })?;
            self.txt_metadata(&manifest)?;
            return Ok(manifest);
        }
        let (text, enc) = self.txt_decode(id, &prefs)?;
        let sections = split::split(&text, pattern, max, settings.fallback_chunk_chars)?;
        let lang = language(&text);
        fs::create_dir_all(&dir).map_err(io_error)?;
        safe(self, &dir)?;
        let mut manifest = TxtManifest {
            book_id: id.into(),
            encoding: enc,
            detected_encoding: enc,
            lang,
            total_chars: text.encode_utf16().count() as u64,
            sections: Vec::with_capacity(sections.len()),
        };
        for (i, s) in sections.iter().enumerate() {
            let path = dir.join(format!("s{:04}.html", i + 1));
            safe(self, &path)?;
            let html = html::render(&s.title, &text[s.heading_end..s.end], &manifest.lang, mode);
            fs::write(&path, html).map_err(io_error)?;
            manifest.sections.push(TxtSection {
                index: i as u32,
                title: s.title.clone(),
                path: path.to_string_lossy().into_owned(),
                start_char: s.start_char,
                chars: s.chars,
            });
        }
        crate::storage::atomic_write(
            &manifest_path,
            &serde_json::to_value(&manifest).map_err(io_error)?,
        )?;
        self.txt_metadata(&manifest)?;
        Ok(manifest)
    }
    fn txt_metadata(&self, manifest: &TxtManifest) -> Result<(), AppError> {
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            tx.execute(
                "UPDATE books SET total_chars=?2,language=?3 WHERE id=?1",
                params![manifest.book_id, i64::try_from(manifest.total_chars).map_err(db_error)?, manifest.lang],
            )
            .map_err(db_error)?;
            tx.execute(
                "INSERT INTO book_prefs(book_id,txt_detected_enc) VALUES (?1,?2) ON CONFLICT(book_id) DO UPDATE SET txt_detected_enc=excluded.txt_detected_enc",
                params![
                    manifest.book_id,
                    super::enum_string(manifest.detected_encoding)?
                ],
            )
            .map_err(db_error)?;
            tx.commit().map_err(db_error)
        })
    }
}
