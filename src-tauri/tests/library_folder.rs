use e_reader_lib::{
    contract::*,
    db::{Database, NewBook},
    import::{ImportEvent, Library},
    library_folder,
    profile::Profile,
    settings::{self, LoadedSettings},
    storage::io_error,
};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
const ID: &str = "0123456789abcdef0123456789abcdef";
fn fixture() -> (tempfile::TempDir, Database, LoadedSettings) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-profile/folder-tests");
    fs::create_dir_all(&root).unwrap();
    let temp = tempfile::tempdir_in(e_reader_lib::profile::canonical(&root).unwrap()).unwrap();
    let profile = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("owner profile")
    })
    .unwrap();
    let settings = settings::load(&profile, || panic!("Documents")).unwrap();
    let db = Database::open(profile, settings.library_dir.clone());
    (temp, db, settings)
}
fn book(db: &Database) {
    fs::create_dir_all(db.library_dir()).unwrap();
    fs::write(db.library_dir().join(format!("{ID}.txt")), "book").unwrap();
    db.insert(&NewBook {
        id: ID.into(),
        format: "txt".into(),
        title: "Book".into(),
        author: None,
        language: None,
        file_name: "original.txt".into(),
        file_size: 4,
        cover: false,
        metadata: serde_json::json!({}),
    })
    .unwrap();
}
fn change(
    db: &Database,
    settings: &mut LoadedSettings,
    path: Option<&str>,
    moves: bool,
) -> Result<LibrarySetFolderResult, AppError> {
    library_folder::change(
        &db.profile,
        db,
        settings,
        path,
        moves,
        &db.profile.root.join("library"),
        |_| Ok(()),
    )
}
#[test]
fn moves_generated_files_and_updates_runtime_and_saved_root() {
    let (temp, db, mut settings) = fixture();
    book(&db);
    let old = db.get(ID).unwrap().file_path;
    let destination = temp.path().join("books");
    let dest = destination.to_str().unwrap();
    let result = change(&db, &mut settings, Some(dest), true).unwrap();
    assert_eq!(result.moved, 1);
    assert!(result.failed.is_empty());
    assert!(!Path::new(&old).exists());
    assert_eq!(
        fs::read(destination.join(format!("{ID}.txt"))).unwrap(),
        b"book"
    );
    assert!(!db.get(ID).unwrap().file_missing);
    assert_eq!(db.library_dir(), destination);
    assert_eq!(
        settings::load(&db.profile, || panic!())
            .unwrap()
            .library_dir,
        destination
    );
    let result = change(&db, &mut settings, None, true).unwrap();
    assert_eq!(result.moved, 1);
    assert!(settings.effective.library.folder.is_none());
}
#[test]
fn no_move_keeps_source_and_reports_missing_at_new_root() {
    let (temp, db, mut settings) = fixture();
    book(&db);
    let old = db.get(ID).unwrap().file_path;
    let destination = temp.path().join("books");
    let result = change(&db, &mut settings, destination.to_str(), false).unwrap();
    assert_eq!(result.moved, 0);
    assert!(Path::new(&old).exists());
    assert!(db.get(ID).unwrap().file_missing);
}
#[test]
fn missing_file_is_a_per_book_failure_after_folder_commit() {
    let (temp, db, mut settings) = fixture();
    book(&db);
    fs::remove_file(db.get(ID).unwrap().file_path).unwrap();
    let dest = temp.path().join("books");
    let result = change(&db, &mut settings, dest.to_str(), true).unwrap();
    assert_eq!(result.failed.len(), 1);
    assert_eq!(result.failed[0].book_id, ID);
    assert_eq!(db.library_dir(), dest);
    assert!(db.get(ID).unwrap().file_missing);
}
#[test]
fn rejects_invalid_protected_and_malformed_paths_before_grant() {
    let (_temp, db, mut settings) = fixture();
    let previous = settings.effective.clone();
    for path in [
        "relative",
        r"\\.\C:\books",
        r"\\server",
        "C:\\bad\0name",
        db.profile.root.to_str().unwrap(),
        db.profile.cache.to_str().unwrap(),
        db.profile.covers.to_str().unwrap(),
        db.profile.root.parent().unwrap().to_str().unwrap(),
    ] {
        let result = library_folder::change(
            &db.profile,
            &db,
            &mut settings,
            Some(path),
            true,
            &db.profile.root.join("library"),
            |_| panic!("invalid scope grant"),
        );
        assert_eq!(
            result.unwrap_err().code,
            ErrorCode::LibraryFolderInvalid,
            "{path}"
        );
    }
    assert_eq!(settings.effective, previous);
    assert!(!db.profile.settings.exists());
}
#[test]
fn scope_or_settings_failure_preserves_source_and_effective_root() {
    let (temp, db, mut settings) = fixture();
    book(&db);
    let old = db.library_dir();
    let dest = temp.path().join("books");
    library_folder::change(
        &db.profile,
        &db,
        &mut settings,
        dest.to_str(),
        true,
        &db.profile.root.join("library"),
        |_| Err(io_error("scope failure")),
    )
    .unwrap_err();
    assert_eq!(db.library_dir(), old);
    assert!(!db.get(ID).unwrap().file_missing);
    fs::create_dir(&db.profile.settings).unwrap();
    change(&db, &mut settings, dest.to_str(), true).unwrap_err();
    assert_eq!(db.library_dir(), old);
    assert!(!db.get(ID).unwrap().file_missing);
    assert!(settings.effective.library.folder.is_none());
}
#[test]
fn destination_collision_never_overwrites_unowned_file() {
    let (temp, db, mut settings) = fixture();
    book(&db);
    let dest = temp.path().join("books");
    fs::create_dir(&dest).unwrap();
    let collision = dest.join(format!("{ID}.txt"));
    fs::write(&collision, "unowned").unwrap();
    assert_eq!(
        change(&db, &mut settings, dest.to_str(), true)
            .unwrap_err()
            .code,
        ErrorCode::LibraryFolderInvalid
    );
    assert_eq!(fs::read(collision).unwrap(), b"unowned");
    assert!(!db.get(ID).unwrap().file_missing);
}
#[test]
fn same_canonical_default_is_noop_without_settings_write() {
    let (_temp, db, mut settings) = fixture();
    let path = db.profile.root.join("library/../library");
    let result = change(&db, &mut settings, path.to_str(), true).unwrap();
    assert_eq!(result.moved, 0);
    assert!(!db.profile.settings.exists());
    assert!(settings.effective.library.folder.is_none());
}
#[test]
fn folder_grant_keeps_settings_database_and_originals_denied() {
    let (temp, db, mut settings) = fixture();
    book(&db);
    let app = tauri::test::mock_app();
    let scope =
        tauri::scope::fs::Scope::new(&app, &tauri::utils::config::FsScope::AllowedPaths(vec![]))
            .unwrap();
    let dest = temp.path().join("books");
    let original = temp.path().join("original.txt");
    fs::write(&original, "original").unwrap();
    library_folder::change(
        &db.profile,
        &db,
        &mut settings,
        dest.to_str(),
        true,
        &db.profile.root.join("library"),
        |path| scope.allow_directory(path, true).map_err(io_error),
    )
    .unwrap();
    assert!(scope.is_allowed(db.get(ID).unwrap().file_path));
    for path in [
        &db.profile.root,
        &db.profile.settings,
        &db.profile.database,
        &original,
    ] {
        assert!(!scope.is_allowed(path));
    }
}
#[test]
fn imports_after_a_folder_change_use_the_new_root_and_clean_journal() {
    let (temp, db, mut settings) = fixture();
    let source = temp.path().join("original.txt");
    fs::write(&source, "original book").unwrap();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let library = Library::start(db, move |event| {
        if let ImportEvent::Done(result) = event {
            done_tx.send(result).unwrap();
        }
    });
    library
        .enqueue("before".into(), vec![source.to_string_lossy().into_owned()])
        .unwrap();
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let dest = temp.path().join("books");
    library
        .with_idle(|| {
            library.prepare_folder_change()?;
            change(&library.db, &mut settings, dest.to_str(), true)
        })
        .unwrap();
    fs::write(&source, "another book").unwrap();
    library
        .enqueue("after".into(), vec![source.to_string_lossy().into_owned()])
        .unwrap();
    assert_eq!(
        done_rx.recv_timeout(Duration::from_secs(2)).unwrap().added,
        1
    );
    library
        .with_idle(|| {
            assert!(
                library
                    .db
                    .list()?
                    .iter()
                    .all(
                        |book| Path::new(&book.file_path).parent() == Some(dest.as_path())
                            && !book.file_missing
                    )
            );
            library.prepare_folder_change()
        })
        .unwrap();
    library.close();
}
#[test]
fn folder_barrier_waits_for_entire_accepted_import_jobs() {
    let (temp, db, _settings) = fixture();
    let source = temp.path().join("input.txt");
    fs::write(&source, "chapter\nbook content").unwrap();
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let release = Mutex::new(release_rx);
    let library = Arc::new(Library::start(db, move |event| {
        if let ImportEvent::Item(_) = event {
            entered_tx.send(()).unwrap();
            release.lock().unwrap().recv().unwrap();
        }
    }));
    library
        .enqueue("one".into(), vec![source.to_string_lossy().into_owned()])
        .unwrap();
    entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let other = library.clone();
    let worker = std::thread::spawn(move || {
        other
            .with_idle(|| {
                done_tx.send(()).unwrap();
                Ok(())
            })
            .unwrap()
    });
    assert!(done_rx.recv_timeout(Duration::from_millis(80)).is_err());
    release_tx.send(()).unwrap();
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    worker.join().unwrap();
    library.close();
}

#[test]
fn folder_commit_uses_short_settings_section_and_preserves_concurrent_changes() {
    let (temp, db, settings) = fixture();
    book(&db);
    let live = Mutex::new(settings.clone());
    let mut snapshot = settings;
    let destination = temp.path().join("changed");
    let old_file = db.get(ID).unwrap().file_path;
    let result = library_folder::change_with_commit(
        &db.profile,
        &db,
        &mut snapshot,
        destination.to_str(),
        true,
        &db.profile.root.join("library"),
        |_| {
            // Work outside the live settings critical section can acquire it freely.
            live.try_lock().unwrap().effective.stats.enabled = false;
            Ok(())
        },
        |candidate| {
            assert!(Path::new(&old_file).exists(), "commit must precede moves");
            let mut settings = live.try_lock().unwrap();
            let mut merged = settings.clone();
            merged.effective.library = candidate.effective.library.clone();
            merged.library_dir = candidate.library_dir.clone();
            merged.write(&db.profile.settings)?;
            *settings = merged;
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(result.moved, 1);
    assert!(!live.lock().unwrap().effective.stats.enabled);
    assert!(
        !settings::load(&db.profile, || panic!())
            .unwrap()
            .effective
            .stats
            .enabled
    );
}

#[test]
fn choosing_custom_folder_does_not_require_the_default_root_to_be_valid() {
    let (temp, db, mut settings) = fixture();
    let default = db.library_dir();
    fs::write(&default, "default folder is unavailable").unwrap();
    let destination = temp.path().join("available");
    change(&db, &mut settings, destination.to_str(), false).unwrap();
    assert_eq!(db.library_dir(), destination);
    assert!(!db.library_offline());
    assert!(settings.effective.library.folder.is_some());
}
