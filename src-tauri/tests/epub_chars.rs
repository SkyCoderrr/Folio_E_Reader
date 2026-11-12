use e_reader_lib::{
    contract::*,
    db::{Database, NewBook, db_error},
    profile::Profile,
};
use rusqlite::Connection;
use std::{collections::BTreeMap, fs};
const ID: &str = "0123456789abcdef0123456789abcdef";
const OTHER: &str = "1123456789abcdef0123456789abcdef";
fn setup() -> (tempfile::TempDir, Database) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-profile/epub-chars");
    fs::create_dir_all(&root).unwrap();
    let temp = tempfile::tempdir_in(root).unwrap();
    let profile = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("real profile")
    })
    .unwrap();
    let library = profile.root.join("library");
    fs::create_dir_all(&library).unwrap();
    let db = Database::open(profile, library);
    for id in [ID, OTHER] {
        let bytes = include_bytes!("../../tests/fixtures/alice.epub");
        fs::write(db.library_dir().join(format!("{id}.epub")), bytes).unwrap();
        db.insert(&NewBook {
            id: id.into(),
            format: "epub".into(),
            title: "Test".into(),
            author: None,
            language: None,
            file_name: "test.epub".into(),
            file_size: bytes.len() as u64,
            cover: false,
            metadata: serde_json::json!({}),
        })
        .unwrap();
    }
    (temp, db)
}
#[test]
fn measurements_reopen_invalidate_by_content_and_cascade() {
    let (_temp, db) = setup();
    let mut metrics = db.open_book(ID).unwrap().epub_metrics.unwrap();
    assert_eq!(metrics.file_hash.len(), 64);
    assert!(metrics.section_chars.is_empty());
    metrics.section_chars = vec![Some(3), None, Some(7)];
    metrics.toc_fragment_offsets = BTreeMap::from([("a#x".into(), 2)]);
    db.book_set_section_chars(ID, metrics.clone()).unwrap();
    let profile = db.profile.clone();
    let library = db.library_dir();
    drop(db);
    let db = Database::open(profile, library);
    assert_eq!(
        db.open_book(ID).unwrap().epub_metrics,
        Some(metrics.clone())
    );
    assert_eq!(db.get(ID).unwrap().total_chars, None);
    metrics.section_chars[1] = Some(5);
    db.book_set_section_chars(ID, metrics.clone()).unwrap();
    assert_eq!(db.get(ID).unwrap().total_chars, Some(15));
    fs::copy(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/pride-and-prejudice.epub"),
        db.library_dir().join(format!("{ID}.epub")),
    )
    .unwrap();
    let changed = db.open_book(ID).unwrap().epub_metrics.unwrap();
    assert_ne!(changed.file_hash, metrics.file_hash);
    assert!(changed.section_chars.is_empty());
    assert_eq!(
        db.book_set_section_chars(ID, metrics).unwrap_err().code,
        ErrorCode::InvalidArgument
    );
    db.remove(&[ID.into()]).unwrap();
    db.with(|c| {
        assert_eq!(
            c.query_row("SELECT count(*) FROM epub_section_chars", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        Ok(())
    })
    .unwrap();
}
#[test]
fn book_open_stats_seed_is_book_scoped_and_uses_latest_thirty_active_minutes() {
    let (_temp, db) = setup();
    assert_eq!(
        db.open_book(ID).unwrap().stats_seed,
        BookStatsSeed {
            active_ms: 0,
            chars: 0,
            chars_per_min: None
        }
    );
    db.with(|c| {
        for (id, end, active, chars) in [(ID, 1, 1_200_000, 1200), (ID, 2, 1_200_000, 2400), (OTHER, 3, 9_000_000, 99999)] {
            c.execute("INSERT INTO sessions(book_id,local_day,started_at,ended_at,active_ms,chars_advanced,start_progress,end_progress) VALUES (?1,'2026-11-12',0,?2,?3,?4,0,0)", rusqlite::params![id, end, active, chars]).map_err(db_error)?;
        } Ok(())
    }).unwrap();
    let seed = db.open_book(ID).unwrap().stats_seed;
    assert_eq!(seed.active_ms, 2_400_000);
    assert_eq!(seed.chars, 3600);
    assert_eq!(seed.chars_per_min, Some(100.0));
    let query = db.stats_query("2026-11-12", "2026-11-12").unwrap();
    assert_eq!(
        seed.chars_per_min,
        query
            .books
            .iter()
            .find(|b| b.book_id == ID)
            .unwrap()
            .chars_per_min
    );
}
#[test]
fn v2_migration_preserves_existing_data_and_creates_cache() {
    let (_temp, db) = setup();
    let profile = db.profile.clone();
    let library = db.library_dir();
    drop(db);
    let c = Connection::open(&profile.database).unwrap();
    c.execute_batch("DROP TABLE epub_section_chars; PRAGMA user_version=2;")
        .unwrap();
    drop(c);
    let db = Database::open(profile.clone(), library);
    assert_eq!(db.get(ID).unwrap().title, "Test");
    assert!(
        db.open_book(ID)
            .unwrap()
            .epub_metrics
            .unwrap()
            .section_chars
            .is_empty()
    );
    assert!(profile.root.join("library.db.bak-v2").exists());
}
