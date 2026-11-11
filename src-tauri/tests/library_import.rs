use e_reader_lib::{
    contract::*,
    db::Database,
    import::{self, ImportEvent, Library, journal::Journal},
    profile::Profile,
};
use std::{
    fs::{self, File},
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::{Mutex, mpsc},
    time::Duration,
};
use zip::{ZipWriter, write::SimpleFileOptions};
fn database() -> (tempfile::TempDir, Database) {
    let temp = tempfile::tempdir().unwrap();
    let p = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("real profile")
    })
    .unwrap();
    let library = p.default_library(|| panic!("Documents")).unwrap();
    (temp, Database::open(p, library))
}
fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures")
        .join(name)
}
fn epub(path: &Path, metadata: &str, manifest: &str, cover: bool, encryption: Option<&str>) {
    let mut writer = ZipWriter::new(File::create(path).unwrap());
    let options = SimpleFileOptions::default();
    let mut entry = |name: &str, bytes: &[u8]| {
        writer.start_file(name, options).unwrap();
        writer.write_all(bytes).unwrap();
    };
    entry("META-INF/container.xml",br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>"#);
    entry("OPS/book.opf",format!(r#"<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>{metadata}</metadata><manifest>{manifest}</manifest></package>"#).as_bytes());
    if cover {
        let mut bytes = Cursor::new(Vec::new());
        image::RgbImage::from_pixel(400, 600, image::Rgb([30, 100, 150]))
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        entry("OPS/cover.png", bytes.get_ref());
    }
    if let Some(encryption) = encryption {
        entry("META-INF/encryption.xml", encryption.as_bytes());
    }
    writer.finish().unwrap();
}
fn add(db: &Database, path: &Path) -> BookRecord {
    let mut journal = Journal::load(db).unwrap();
    let (outcome, book) = import::pipeline::item(db, &mut journal, path).unwrap();
    assert_eq!(outcome, ImportOutcome::Added);
    book.unwrap()
}
fn job(db: &Database, paths: Vec<String>) -> Vec<ImportEvent> {
    let events = Mutex::new(Vec::new());
    import::run_job(
        db,
        &Mutex::new(()),
        &mut Journal::load(db).unwrap(),
        LibraryImportArgs {
            job_id: "test-job".into(),
            paths,
        },
        &|event| events.lock().unwrap().push(event),
    );
    events.into_inner().unwrap()
}
#[path = "library_import/metadata.rs"]
mod metadata;
#[path = "library_import/recovery.rs"]
mod recovery;

#[test]
fn walk_events_have_fixed_totals_contiguous_indices_and_exact_outcomes() {
    let (temp, db) = database();
    let folder = temp.path().join("input");
    fs::create_dir_all(folder.join("B")).unwrap();
    for name in ["a.TXT", "B/c.txt", "z.txt", "skip.pdf"] {
        fs::write(folder.join(name), name).unwrap();
    }
    let paths = vec![
        folder.to_string_lossy().into_owned(),
        folder.join("skip.pdf").to_string_lossy().into_owned(),
        folder.join("unresolved").to_string_lossy().into_owned(),
    ];
    let events = job(&db, paths);
    let names: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            ImportEvent::Item(i) => Some(i.file_name.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(names, ["a.TXT", "c.txt", "z.txt", "skip.pdf", "unresolved"]);
    for (index, event) in events.iter().take(5).enumerate() {
        if let ImportEvent::Item(item) = event {
            assert_eq!(item.index, index as u32);
            assert_eq!(item.total, 5);
            if let Some(b) = &item.book {
                assert!(Path::new(&b.file_path).is_file());
                assert!(db.get(&b.id).is_ok());
            }
        }
    }
    let ImportEvent::Done(done) = events.last().unwrap() else {
        panic!()
    };
    assert_eq!((done.total, done.added, done.duplicates), (5, 3, 0));
    assert_eq!(done.unsupported, ["skip.pdf"]);
    assert_eq!(done.failed.len(), 1);
    assert_eq!(done.failed[0].error.code, ErrorCode::IoError);
}
#[test]
fn fifty_book_folder_uses_existing_fixtures_and_metadata() {
    let (temp, db) = database();
    let folder = temp.path().join("fifty");
    fs::create_dir(&folder).unwrap();
    for (i, name) in [
        "alice.epub",
        "pride-and-prejudice.epub",
        "xiyouji-ch1-3.epub",
        "xiyouji-ch1-5-utf8.txt",
        "xiyouji-ch1-5-gbk.txt",
    ]
    .iter()
    .enumerate()
    {
        fs::copy(fixture(name), folder.join(format!("{i}-{name}"))).unwrap();
    }
    for i in 5..50 {
        epub(
            &folder.join(format!("{i:02}.epub")),
            &format!("<dc:title>Fixture {i}</dc:title><dc:creator>Writer {i}</dc:creator>"),
            r#"<item id="c" href="cover.png" properties="cover-image"/>"#,
            true,
            None,
        );
    }
    let events = job(&db, vec![folder.to_string_lossy().into_owned()]);
    let ImportEvent::Done(done) = events.last().unwrap() else {
        panic!()
    };
    assert_eq!((done.total, done.added), (50, 50), "{:?}", done.failed);
    assert!(done.failed.is_empty());
    for b in db
        .list()
        .unwrap()
        .into_iter()
        .filter(|b| b.title.starts_with("Fixture "))
    {
        assert!(b.author.unwrap().starts_with("Writer "));
        assert!(b.cover_path.is_some());
    }
}
#[test]
fn queue_is_fifo_rejects_reused_ids_and_zero_candidate_jobs_finish() {
    let (temp, db) = database();
    let empty = temp.path().join("empty");
    fs::create_dir(&empty).unwrap();
    let source = temp.path().join("book.txt");
    fs::write(&source, "hello").unwrap();
    let (tx, rx) = mpsc::channel();
    let library = Library::start(db, move |e| tx.send(e).unwrap());
    for (id, path) in [
        ("first", &source),
        ("empty", &empty),
        ("duplicate", &source),
    ] {
        library
            .enqueue(id.into(), vec![path.to_string_lossy().into_owned()])
            .unwrap();
    }
    assert_eq!(
        library
            .enqueue("first".into(), vec![source.to_string_lossy().into_owned()])
            .unwrap_err()
            .code,
        ErrorCode::InvalidArgument
    );
    let mut completed = Vec::new();
    while completed.len() < 3 {
        if let ImportEvent::Done(done) = rx.recv_timeout(Duration::from_secs(10)).unwrap() {
            completed.push(done);
        }
    }
    assert_eq!(
        completed
            .iter()
            .map(|d| d.job_id.as_str())
            .collect::<Vec<_>>(),
        ["first", "empty", "duplicate"]
    );
    assert_eq!(completed[1].total, 0);
    assert_eq!(completed[2].duplicates, 1);
    library.close();
    assert!(
        library
            .enqueue("closed".into(), vec![source.to_string_lossy().into_owned()])
            .is_err()
    );
}
#[test]
fn journal_recovers_only_owned_files_and_retains_committed_book_copy() {
    let (temp, db) = database();
    let source = temp.path().join("original.txt");
    fs::write(&source, "original").unwrap();
    let b = add(&db, &source);
    let stage = db.library_dir().join(".import-interrupted.tmp");
    let orphan = db
        .library_dir()
        .join("00000000000000000000000000000000.epub");
    fs::write(&stage, "partial").unwrap();
    fs::write(&orphan, "orphan").unwrap();
    let unowned = db
        .library_dir()
        .join("11111111111111111111111111111111.txt");
    fs::write(&unowned, "unowned").unwrap();
    let journal = serde_json::json!([
        {"path":stage,"book_id":null,"durable":false},
        {"path":orphan,"book_id":"00000000000000000000000000000000","durable":true},
        {"path":b.file_path,"book_id":b.id,"durable":true}
    ]);
    fs::write(
        db.profile.root.join("import-journal.json"),
        journal.to_string(),
    )
    .unwrap();
    Journal::load(&db).unwrap();
    assert!(!stage.exists());
    assert!(!orphan.exists());
    assert!(unowned.exists());
    assert!(source.exists());
    assert!(Path::new(&b.file_path).exists());
}
#[test]
fn journal_rejects_paths_outside_generated_roots_without_deleting_originals() {
    let (temp, db) = database();
    let original = temp.path().join("original.txt");
    fs::write(&original, "keep").unwrap();
    fs::write(
        db.profile.root.join("import-journal.json"),
        serde_json::json!([{"path":original,"book_id":null,"durable":false}]).to_string(),
    )
    .unwrap();
    assert!(Journal::load(&db).is_err());
    assert!(original.exists());
}
