use super::*;

#[test]
fn database_insert_failure_cleans_published_copy_cover_and_staging() {
    let (temp, db) = database();
    let source = temp.path().join("source.epub");
    epub(
        &source,
        "",
        r#"<item id="c" href="cover.png" properties="cover-image"/>"#,
        true,
        None,
    );
    db.with(|c| c.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON books BEGIN SELECT RAISE(ABORT,'test failure'); END;").map_err(e_reader_lib::db::db_error)).unwrap();
    let error = import::pipeline::item(&db, &mut Journal::load(&db).unwrap(), &source).unwrap_err();
    assert_eq!(error.code, ErrorCode::DbError);
    assert!(source.exists());
    assert!(db.list().unwrap().is_empty());
    let files: Vec<_> = walkdir::WalkDir::new(db.library_dir())
        .into_iter()
        .map(Result::unwrap)
        .filter(|e| e.file_type().is_file())
        .collect();
    assert!(files.is_empty(), "owned files were left behind");
}
#[test]
fn unowned_hash_named_destination_is_never_overwritten_or_deleted() {
    let (temp, db) = database();
    let source = temp.path().join("source.txt");
    fs::write(&source, "source").unwrap();
    let id = blake3::hash(b"source").to_hex()[..32].to_string();
    fs::create_dir(db.library_dir()).unwrap();
    let target = db.library_dir().join(format!("{id}.txt"));
    fs::write(&target, "unowned").unwrap();
    assert!(import::pipeline::item(&db, &mut Journal::load(&db).unwrap(), &source).is_err());
    assert_eq!(fs::read(target).unwrap(), b"unowned");
    assert_eq!(fs::read(source).unwrap(), b"source");
    assert!(db.list().unwrap().is_empty());
}
#[test]
fn imported_assets_are_readable_but_settings_db_and_originals_stay_denied() {
    let (temp, db) = database();
    let app = tauri::test::mock_app();
    let scope =
        tauri::scope::fs::Scope::new(&app, &tauri::utils::config::FsScope::AllowedPaths(vec![]))
            .unwrap();
    let source = temp.path().join("source.epub");
    epub(
        &source,
        "",
        r#"<item id="c" href="cover.png" properties="cover-image"/>"#,
        true,
        None,
    );
    let b = add(&db, &source);
    assert!(!scope.is_allowed(&b.file_path));
    db.managed_path(Path::new(&b.file_path)).unwrap();
    scope.allow_file(&b.file_path).unwrap();
    assert!(scope.is_allowed(&b.file_path));
    let cover = b.cover_path.unwrap();
    db.managed_path(Path::new(&cover)).unwrap();
    scope.allow_file(&cover).unwrap();
    assert!(scope.is_allowed(cover));
    assert!(!scope.is_allowed(source));
    assert!(!scope.is_allowed(&db.profile.root));
    assert!(!scope.is_allowed(&db.profile.settings));
    assert!(!scope.is_allowed(&db.profile.database));
    assert!(!scope.is_allowed(db.profile.root.join("import-journal.json")));
}
#[test]
fn bad_queue_arguments_and_newer_database_emit_no_events() {
    let (temp, db) = database();
    let p = db.profile.clone();
    drop(db);
    rusqlite::Connection::open(&p.database)
        .unwrap()
        .execute_batch("PRAGMA user_version=42")
        .unwrap();
    let db = Database::open(p.clone(), p.root.join("library"));
    let (tx, rx) = mpsc::channel();
    let library = Library::start(db, move |e| tx.send(e).unwrap());
    let source = temp
        .path()
        .join("source.txt")
        .to_string_lossy()
        .into_owned();
    for (id, paths) in [
        ("", vec![source.clone()]),
        ("bad id", vec![source.clone()]),
        ("okay", vec![]),
        ("okay", vec!["relative.txt".into()]),
    ] {
        assert_eq!(
            library.enqueue(id.into(), paths).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
    assert_eq!(
        library
            .enqueue("okay".into(), vec![source])
            .unwrap_err()
            .code,
        ErrorCode::DbVersionUnsupported
    );
    assert!(rx.try_recv().is_err());
}
#[test]
fn oversized_opf_is_bounded_before_expansion() {
    let (temp, db) = database();
    let source = temp.path().join("oversize.epub");
    let mut writer = ZipWriter::new(File::create(&source).unwrap());
    writer
        .start_file("META-INF/container.xml", SimpleFileOptions::default())
        .unwrap();
    writer
        .write_all(br#"<container><rootfile full-path="book.opf"/></container>"#)
        .unwrap();
    writer
        .start_file("book.opf", SimpleFileOptions::default())
        .unwrap();
    writer.write_all(&vec![b'x'; 4 * 1024 * 1024 + 1]).unwrap();
    writer.finish().unwrap();
    assert_eq!(
        import::pipeline::item(&db, &mut Journal::load(&db).unwrap(), &source)
            .unwrap_err()
            .code,
        ErrorCode::EpubInvalid
    );
    assert!(db.list().unwrap().is_empty());
}
#[cfg(windows)]
#[test]
fn folder_walk_does_not_follow_junctions() {
    use std::os::windows::process::CommandExt;
    let (temp, db) = database();
    let input = temp.path().join("input");
    let outside = temp.path().join("outside");
    fs::create_dir(&input).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.txt"), "secret").unwrap();
    let link = input.join("junction");
    let output=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","New-Item -ItemType Junction -Path $env:E_READER_TEST_LINK -Target $env:E_READER_TEST_TARGET | Out-Null"]).env("E_READER_TEST_LINK",&link).env("E_READER_TEST_TARGET",&outside).creation_flags(0x08000000).output().unwrap();
    assert!(output.status.success());
    let events = job(
        &db,
        vec![
            input.to_string_lossy().into_owned(),
            link.to_string_lossy().into_owned(),
        ],
    );
    let ImportEvent::Done(done) = events.last().unwrap() else {
        panic!()
    };
    assert_eq!(done.total, 0);
    assert!(outside.join("secret.txt").exists());
}
