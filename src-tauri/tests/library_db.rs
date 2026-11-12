use e_reader_lib::{
    contract::*,
    db::{Database, NewBook, db_error},
    profile::Profile,
};
use rusqlite::Connection;
use serde_json::json;
use std::fs;
const ID: &str = "0123456789abcdef0123456789abcdef";
fn profile() -> (tempfile::TempDir, Profile) {
    let temp = tempfile::tempdir().unwrap();
    let p = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("real profile")
    })
    .unwrap();
    (temp, p)
}
fn database() -> (tempfile::TempDir, Database) {
    let (temp, p) = profile();
    let library = p.default_library(|| panic!("Documents")).unwrap();
    (temp, Database::open(p, library))
}
fn book(db: &Database) -> BookRecord {
    fs::create_dir_all(db.library_dir()).unwrap();
    fs::write(db.library_dir().join(format!("{ID}.txt")), "test").unwrap();
    db.insert(&NewBook {
        id: ID.into(),
        format: "txt".into(),
        title: "Title".into(),
        author: None,
        language: None,
        file_name: "original.txt".into(),
        file_size: 4,
        cover: false,
        metadata: json!({}),
    })
    .unwrap()
}
fn locator(progress: f64) -> serde_json::Value {
    json!({"sectionIndex":2,"cfi":null,"charOffset":12,"globalCharOffset":null,"progress":progress,"snippet":"中文😀"})
}
#[test]
fn schema_is_exact_contract_snapshot_and_strict_with_pragmas() {
    let (_temp, db) = database();
    db.with(|c| {
        let expected = Connection::open_in_memory().unwrap();
        expected
            .execute_batch(include_str!("../../contract/db-schema.sql"))
            .unwrap();
        let schema = |c: &Connection| {
            c.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name")
                .unwrap()
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .map(|sql| sql.unwrap().replace("\r\n", "\n"))
                .collect::<Vec<_>>()
        };
        assert_eq!(schema(c), schema(&expected));
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM pragma_table_list WHERE strict=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            7
        );
        for (pragma, value) in [
            ("foreign_keys", 1),
            ("synchronous", 1),
            ("busy_timeout", 5000),
            ("user_version", 3),
        ] {
            assert_eq!(
                c.pragma_query_value(None, pragma, |r| r.get::<_, i64>(0))
                    .unwrap(),
                value
            );
        }
        assert_eq!(
            c.pragma_query_value(None, "journal_mode", |r| r.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        Ok(())
    })
    .unwrap();
}
#[test]
fn older_database_backup_includes_committed_wal_and_is_preserved() {
    let (_temp, p) = profile();
    let source = Connection::open(&p.database).unwrap();
    source.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('WAL data');").unwrap();
    let db = Database::open(p.clone(), p.root.join("library"));
    db.available().unwrap();
    let backup = p.root.join("library.db.bak-v0");
    let bytes = fs::read(&backup).unwrap();
    let saved = Connection::open(&backup).unwrap();
    assert_eq!(
        saved
            .query_row("SELECT value FROM sentinel", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "WAL data"
    );
    assert_eq!(
        saved
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(saved);
    drop(db);
    drop(source);
    Database::open(p.clone(), p.root.join("library"))
        .available()
        .unwrap();
    assert_eq!(bytes, fs::read(backup).unwrap());
}
#[test]
fn failed_migration_rolls_back_and_disables_only_database() {
    let (_temp, p) = profile();
    Connection::open(&p.database)
        .unwrap()
        .execute_batch("CREATE TABLE books(conflict TEXT)")
        .unwrap();
    let db = Database::open(p.clone(), p.root.join("library"));
    assert_eq!(db.list().unwrap_err().code, ErrorCode::DbError);
    let source = Connection::open(&p.database).unwrap();
    assert_eq!(
        source
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        source
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='positions'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert!(e_reader_lib::settings::load(&p, || panic!()).is_ok());
}
#[test]
fn newer_database_is_untouched_and_all_repositories_reject() {
    let (_temp, p) = profile();
    Connection::open(&p.database)
        .unwrap()
        .execute_batch("PRAGMA user_version=999; CREATE TABLE future(value TEXT)")
        .unwrap();
    let before = fs::read(&p.database).unwrap();
    let db = Database::open(p.clone(), p.root.join("library"));
    let errors = [
        db.available().unwrap_err(),
        db.list().unwrap_err(),
        db.get(ID).unwrap_err(),
        db.remove(&[ID.into()]).unwrap_err(),
        db.open_book(ID).unwrap_err(),
        db.position_get(ID).unwrap_err(),
        db.position_save(ID, locator(0.2)).unwrap_err(),
        db.chapters_read_get(ID).unwrap_err(),
        db.chapter_mark_read(ID, "t:0").unwrap_err(),
    ];
    for e in errors {
        assert_eq!(e.code, ErrorCode::DbVersionUnsupported);
        assert_eq!(e.details, Some(json!({"found":999,"supported":3})));
    }
    assert_eq!(db.get("bad").unwrap_err().code, ErrorCode::InvalidArgument);
    assert_eq!(before, fs::read(&p.database).unwrap());
    assert!(!p.root.join("library.db-wal").exists());
    assert!(!p.root.join("library.db.bak-v999").exists());
}
#[test]
fn crud_open_and_position_round_trip_survive_reopen() {
    let (_temp, db) = database();
    assert!(db.list().unwrap().is_empty());
    let original = book(&db);
    assert_eq!(db.get(ID).unwrap(), original);
    assert_eq!(db.position_get(ID).unwrap(), None);
    let opened = db.open_book(ID).unwrap();
    assert!(opened.book.last_opened_at.is_some());
    assert_eq!(opened.txt_prefs.unwrap().encoding, TxtEncoding::Auto);
    db.position_save(ID, locator(0.25)).unwrap();
    let p = db.profile.clone();
    let library = db.library_dir();
    drop(db);
    let db = Database::open(p, library);
    assert_eq!(
        serde_json::to_value(db.position_get(ID).unwrap().unwrap()).unwrap(),
        locator(0.25)
    );
    assert_eq!(db.get(ID).unwrap().progress, 0.25);
    assert_eq!(db.list().unwrap().len(), 1);
}
#[test]
fn finishing_time_never_clears_and_batch_remove_cascades_all_tables() {
    let (_temp, db) = database();
    book(&db);
    db.open_book(ID).unwrap();
    db.position_save(ID, locator(1.0)).unwrap();
    let finished = db.get(ID).unwrap().finished_at.unwrap();
    db.position_save(ID, locator(0.1)).unwrap();
    assert_eq!(db.get(ID).unwrap().finished_at, Some(finished));
    db.with(|c| {
        c.execute(
            "INSERT INTO bookmarks(book_id,locator_json,progress,created_at) VALUES (?1,'{}',0,0)",
            [ID],
        )
        .map_err(db_error)?;
        c.execute(
            "INSERT INTO sessions VALUES(1,?1,'2026-11-10',0,1,1,1,0,0)",
            [ID],
        )
        .map_err(db_error)?;
        Ok(())
    })
    .unwrap();
    let result = db
        .remove(&[
            ID.into(),
            ID.into(),
            "00000000000000000000000000000000".into(),
        ])
        .unwrap();
    assert_eq!(result.removed_ids, [ID]);
    assert!(result.file_errors.is_empty());
    assert!(!db.library_dir().join(format!("{ID}.txt")).exists());
    db.with(|c| {
        for table in ["books", "book_prefs", "positions", "bookmarks", "sessions"] {
            assert_eq!(
                c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        Ok(())
    })
    .unwrap();
}
#[test]
fn position_raw_required_keys_bounds_and_no_kv_migration() {
    let (_temp, db) = database();
    book(&db);
    let kv = e_reader_lib::kv::KvStore::open(db.profile.kv.clone()).unwrap();
    kv.set(&format!("position:{ID}"), locator(0.9)).unwrap();
    assert!(db.position_get(ID).unwrap().is_none());
    for key in [
        "sectionIndex",
        "cfi",
        "charOffset",
        "globalCharOffset",
        "progress",
        "snippet",
    ] {
        let mut value = locator(0.5);
        value.as_object_mut().unwrap().remove(key);
        assert_eq!(
            db.position_save(ID, value).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
    for (key, value) in [
        ("charOffset", json!(9_007_199_254_740_992u64)),
        ("globalCharOffset", json!(-1)),
        ("progress", json!(1.01)),
        ("snippet", json!("😀".repeat(201))),
        ("cfi", json!("x".repeat(4097))),
    ] {
        let mut raw = locator(0.5);
        raw[key] = value;
        assert_eq!(
            db.position_save(ID, raw).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
    assert_eq!(db.get(ID).unwrap().progress, 0.0);
    assert!(db.position_get(ID).unwrap().is_none());
    assert_eq!(kv.get(&format!("position:{ID}")).unwrap(), locator(0.9));
}
#[test]
fn invalid_persisted_paths_prevent_entire_removal_batch() {
    let (_temp, db) = database();
    book(&db);
    let outside = db.profile.root.join("original.txt");
    fs::write(&outside, "never delete").unwrap();
    db.with(|c| {
        c.execute(
            "UPDATE books SET file_rel_path='../original.txt' WHERE id=?1",
            [ID],
        )
        .map_err(db_error)?;
        Ok(())
    })
    .unwrap();
    assert_eq!(db.get(ID).unwrap_err().code, ErrorCode::DbError);
    assert_eq!(
        db.remove(&[ID.into()]).unwrap_err().code,
        ErrorCode::DbError
    );
    assert!(outside.exists());
    db.with(|c| {
        assert_eq!(
            c.query_row("SELECT count(*) FROM books", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        Ok(())
    })
    .unwrap();
}
#[test]
fn invalid_persisted_locator_rolls_back_open_side_effects() {
    let (_temp, db) = database();
    book(&db);
    db.with(|c| {
        c.execute("INSERT INTO positions VALUES (?1,'{}',0)", [ID])
            .map_err(db_error)?;
        Ok(())
    })
    .unwrap();
    assert_eq!(db.open_book(ID).unwrap_err().code, ErrorCode::DbError);
    assert!(db.get(ID).unwrap().last_opened_at.is_none());
}
#[test]
fn missing_file_does_not_update_open_time_or_create_prefs() {
    let (_temp, db) = database();
    let b = book(&db);
    fs::remove_file(&b.file_path).unwrap();
    assert!(db.get(ID).unwrap().file_missing);
    assert_eq!(
        db.open_book(ID).unwrap_err().code,
        ErrorCode::BookFileMissing
    );
    assert!(db.get(ID).unwrap().last_opened_at.is_none());
    db.with(|c| {
        assert_eq!(
            c.query_row("SELECT count(*) FROM book_prefs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        Ok(())
    })
    .unwrap();
}
#[test]
fn database_constraints_reject_non_object_json_and_unsafe_persisted_numbers() {
    let (_temp, db) = database();
    book(&db);
    db.with(|c| {
        assert!(
            c.execute("INSERT INTO positions VALUES (?1,'[]',0)", [ID])
                .is_err()
        );
        assert!(
            c.execute("UPDATE books SET meta_json='[]' WHERE id=?1", [ID])
                .is_err()
        );
        c.execute(
            "UPDATE books SET total_chars=9007199254740992 WHERE id=?1",
            [ID],
        )
        .map_err(db_error)?;
        Ok(())
    })
    .unwrap();
    assert_eq!(db.get(ID).unwrap_err().code, ErrorCode::DbError);
}
