use e_reader_lib::{
    contract::ErrorCode,
    db::{Database, NewBook, db_error},
    profile::Profile,
};
use rusqlite::Connection;
use serde_json::json;

const ID: &str = "0123456789abcdef0123456789abcdef";
const OTHER: &str = "1123456789abcdef0123456789abcdef";

fn profile() -> (tempfile::TempDir, Profile) {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-profile/codex-chapters");
    std::fs::create_dir_all(&root).unwrap();
    let temp = tempfile::tempdir_in(root).unwrap();
    let profile = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("must never resolve the real profile")
    })
    .unwrap();
    (temp, profile)
}

fn book(db: &Database, id: &str) {
    db.insert(&NewBook {
        id: id.into(),
        format: "txt".into(),
        title: "Chapter memory test".into(),
        author: None,
        language: None,
        file_name: "test.txt".into(),
        file_size: 4,
        cover: false,
        metadata: json!({}),
    })
    .unwrap();
}

#[test]
fn empty_list_idempotent_insert_and_first_timestamp_are_preserved() {
    let (_temp, p) = profile();
    let db = Database::open(p.clone(), p.root.join("library"));
    book(&db, ID);
    assert!(db.chapters_read_get(ID).unwrap().chapter_keys.is_empty());
    assert_eq!(
        db.chapter_mark_read(ID, "t:2").unwrap().chapter_keys,
        ["t:2"]
    );
    db.with(|c| {
        c.execute("UPDATE chapter_read SET read_at=1", [])
            .map_err(db_error)?;
        Ok(())
    })
    .unwrap();
    assert_eq!(
        db.chapter_mark_read(ID, "t:2").unwrap().chapter_keys,
        ["t:2"]
    );
    db.with(|c| {
        assert_eq!(
            c.query_row("SELECT read_at FROM chapter_read", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        Ok(())
    })
    .unwrap();
    assert_eq!(
        db.chapter_mark_read(ID, "t:0").unwrap().chapter_keys,
        ["t:2", "t:0"]
    );
}

#[test]
fn keys_are_opaque_and_validated_by_utf8_bytes() {
    let (_temp, p) = profile();
    let db = Database::open(p.clone(), p.root.join("library"));
    book(&db, ID);
    for key in [
        String::new(),
        "a".repeat(513),
        "é".repeat(257),
        "😀".repeat(129),
    ] {
        let error = db.chapter_mark_read(ID, &key).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument);
        assert_eq!(error.details.unwrap()["field"], "chapterKey");
    }
    for key in [
        "a".repeat(512),
        "é".repeat(256),
        "😀".repeat(128),
        " \0# ".into(),
    ] {
        assert!(
            db.chapter_mark_read(ID, &key)
                .unwrap()
                .chapter_keys
                .contains(&key)
        );
    }
    assert_eq!(db.chapters_read_get(ID).unwrap().chapter_keys.len(), 4);
}

#[test]
fn unknown_books_and_invalid_ids_reject_without_rows() {
    let (_temp, p) = profile();
    let db = Database::open(p.clone(), p.root.join("library"));
    for error in [
        db.chapters_read_get(ID).unwrap_err(),
        db.chapter_mark_read(ID, "t:0").unwrap_err(),
    ] {
        assert_eq!(error.code, ErrorCode::BookNotFound);
        assert_eq!(error.details, Some(json!({"bookId": ID})));
    }
    for error in [
        db.chapters_read_get("bad").unwrap_err(),
        db.chapter_mark_read("bad", "t:0").unwrap_err(),
    ] {
        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }
    assert_eq!(
        db.chapter_mark_read(ID, "").unwrap_err().code,
        ErrorCode::InvalidArgument
    );
}

#[test]
fn ordering_uses_first_timestamp_then_binary_key_and_survives_reopen() {
    let (_temp, p) = profile();
    let library = p.root.join("library");
    let db = Database::open(p.clone(), library.clone());
    book(&db, ID);
    book(&db, OTHER);
    for key in ["z", "é", "a", "A"] {
        db.chapter_mark_read(ID, key).unwrap();
    }
    db.chapter_mark_read(OTHER, "other").unwrap();
    db.with(|c| {
        c.execute("UPDATE chapter_read SET read_at=10 WHERE book_id=?1", [ID])
            .map_err(db_error)?;
        c.execute(
            "UPDATE chapter_read SET read_at=1 WHERE chapter_key='z'",
            [],
        )
        .map_err(db_error)?;
        Ok(())
    })
    .unwrap();
    let expected = ["z", "A", "a", "é"];
    assert_eq!(db.chapters_read_get(ID).unwrap().chapter_keys, expected);
    drop(db);
    let reopened = Database::open(p, library);
    assert_eq!(
        reopened.chapters_read_get(ID).unwrap().chapter_keys,
        expected
    );
    assert_eq!(
        reopened.chapters_read_get(OTHER).unwrap().chapter_keys,
        ["other"]
    );
}

#[test]
fn library_remove_cascades_only_the_removed_book_and_reimport_starts_empty() {
    let (_temp, p) = profile();
    let db = Database::open(p.clone(), p.root.join("library"));
    for id in [ID, OTHER] {
        book(&db, id);
        db.chapter_mark_read(id, "t:0").unwrap();
    }
    assert_eq!(db.remove(&[ID.into()]).unwrap().removed_ids, [ID]);
    assert_eq!(
        db.chapters_read_get(ID).unwrap_err().code,
        ErrorCode::BookNotFound
    );
    assert_eq!(db.chapters_read_get(OTHER).unwrap().chapter_keys, ["t:0"]);
    book(&db, ID);
    assert!(db.chapters_read_get(ID).unwrap().chapter_keys.is_empty());
}

#[test]
fn migration_from_v1_preserves_existing_book_position_and_backup() {
    let (_temp, p) = profile();
    let c = Connection::open(&p.database).unwrap();
    c.execute_batch(include_str!("../src/db/001_initial.sql"))
        .unwrap();
    c.execute("INSERT INTO books(id,format,title,file_name,file_rel_path,file_size,added_at) VALUES (?1,'txt','Old book','old.txt',?2,4,0)", [ID, &format!("{ID}.txt")]).unwrap();
    c.execute("INSERT INTO positions VALUES (?1,?2,1)", [ID, r#"{"sectionIndex":0,"cfi":null,"charOffset":12,"globalCharOffset":null,"progress":0.5,"snippet":"saved"}"#]).unwrap();
    drop(c);
    let db = Database::open(p.clone(), p.root.join("library"));
    assert_eq!(db.get(ID).unwrap().title, "Old book");
    assert_eq!(db.position_get(ID).unwrap().unwrap().char_offset, 12);
    assert!(db.chapters_read_get(ID).unwrap().chapter_keys.is_empty());
    db.chapter_mark_read(ID, "t:0").unwrap();
    let backup = Connection::open(p.root.join("library.db.bak-v1")).unwrap();
    assert_eq!(
        backup
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        backup
            .query_row("SELECT title FROM books", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "Old book"
    );
}
