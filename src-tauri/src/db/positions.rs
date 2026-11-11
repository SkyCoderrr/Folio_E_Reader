use super::*;
use rusqlite::{OptionalExtension, params};

pub fn validate(value: &serde_json::Value) -> Result<Locator, AppError> {
    for key in [
        "sectionIndex",
        "cfi",
        "charOffset",
        "globalCharOffset",
        "progress",
        "snippet",
    ] {
        if value.get(key).is_none() {
            return Err(invalid("locator", "Every Locator key is required"));
        }
    }
    let locator: Locator = serde_json::from_value(value.clone())
        .map_err(|_| invalid("locator", "Invalid Locator shape"))?;
    validate_locator(&locator)?;
    Ok(locator)
}
fn validate_locator(locator: &Locator) -> Result<(), AppError> {
    if locator.char_offset > SAFE_INTEGER
        || locator.global_char_offset.is_some_and(|v| v > SAFE_INTEGER)
        || !locator.progress.is_finite()
        || !(0.0..=1.0).contains(&locator.progress)
        || locator.snippet.chars().count() > 200
        || locator
            .cfi
            .as_ref()
            .is_some_and(|c| c.chars().count() > 4096)
    {
        return Err(invalid("locator", "Locator exceeds contract bounds"));
    }
    Ok(())
}
impl Database {
    pub fn position_get(&self, id: &str) -> Result<Option<Locator>, AppError> {
        validate_id(id)?;
        self.with(|c| {
            super::repo::get(c, self, id)?;
            read(c, id)
        })
    }
    pub fn position_save(&self, id: &str, value: serde_json::Value) -> Result<(), AppError> {
        validate_id(id)?;
        let locator = validate(&value)?;
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            super::repo::get(&tx, self, id)?;
            let now = now();
            tx.execute("INSERT INTO positions VALUES (?1,?2,?3) ON CONFLICT(book_id) DO UPDATE SET locator_json=excluded.locator_json, updated_at=excluded.updated_at",
                params![id, serde_json::to_string(&locator).map_err(db_error)?, now]).map_err(db_error)?;
            tx.execute("UPDATE books SET progress=?2, finished_at=CASE WHEN ?2>=0.995 THEN coalesce(finished_at,?3) ELSE finished_at END WHERE id=?1", params![id,locator.progress,now]).map_err(db_error)?;
            tx.commit().map_err(db_error)
        })
    }
}
pub(super) fn read(c: &Connection, id: &str) -> Result<Option<Locator>, AppError> {
    let value: Option<String> = c
        .query_row(
            "SELECT locator_json FROM positions WHERE book_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_error)?;
    value
        .map(|s| {
            let value = serde_json::from_str(&s).map_err(db_error)?;
            validate(&value).map_err(db_error)
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn saved_position_and_book_open_survive_reopening_the_test_profile() {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-profile/fb2-positions");
        std::fs::create_dir_all(&root).unwrap();
        let tmp = tempfile::tempdir_in(root).unwrap();
        let profile = Profile::resolve(Some(tmp.path().join("profile").into_os_string()), || {
            panic!("must not access real profile")
        })
        .unwrap();
        let library = profile.root.join("library");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::write(library.join(format!("{ID}.txt")), "fixture").unwrap();
        let expected = serde_json::json!({
            "sectionIndex": 2, "cfi": null, "charOffset": 123,
            "globalCharOffset": 1234, "progress": 0.3, "snippet": "saved text"
        });
        {
            let db = Database::open(profile.clone(), library.clone());
            db.with(|c| {
                c.execute("INSERT INTO books(id,format,title,file_name,file_rel_path,file_size,added_at) VALUES (?1,'txt','Fixture','fixture.txt',?2,7,0)", params![ID, format!("{ID}.txt")]).map_err(db_error)?;
                Ok(())
            }).unwrap();
            db.position_save(ID, expected.clone()).unwrap();
        }
        let db = Database::open(profile, library);
        assert_eq!(
            serde_json::to_value(db.position_get(ID).unwrap()).unwrap(),
            expected
        );
        let opened = db.open_book(ID).unwrap();
        assert_eq!(serde_json::to_value(opened.locator).unwrap(), expected);
        assert_eq!(opened.book.progress, 0.3);
    }
}
