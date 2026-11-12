use super::{covers, epub_meta, journal::Journal, txt_title, walk};
use crate::{
    contract::*,
    db::{Database, NewBook, SAFE_INTEGER},
};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) struct ImportControl<'a> {
    pub access: &'a super::FileAccess,
    pub revision: u64,
    pub closing: &'a AtomicBool,
}

pub fn item(
    db: &Database,
    journal: &mut Journal,
    path: &Path,
) -> Result<(ImportOutcome, Option<BookRecord>), AppError> {
    db.profile.validate_library(&db.library_dir())?;
    item_with_control(
        db,
        journal,
        path,
        &ImportControl {
            access: &super::FileAccess::default(),
            revision: 0,
            closing: &AtomicBool::new(false),
        },
    )
}
pub(super) fn item_with_control(
    db: &Database,
    journal: &mut Journal,
    path: &Path,
    control: &ImportControl<'_>,
) -> Result<(ImportOutcome, Option<BookRecord>), AppError> {
    item_with_source(db, journal, path, control, || {
        File::open(path).map_err(|e| walk::io(path, "read", e))
    })
}
fn item_with_source<R: Read>(
    db: &Database,
    journal: &mut Journal,
    path: &Path,
    control: &ImportControl<'_>,
    open: impl FnOnce() -> Result<R, AppError>,
) -> Result<(ImportOutcome, Option<BookRecord>), AppError> {
    check_closing(control.closing)?;
    let Some(format) = walk::format(path) else {
        return Ok((ImportOutcome::Unsupported, None));
    };
    if !db.import_root_available() {
        return Err(AppError::new(
            ErrorCode::LibraryFolderInvalid,
            "Library folder is unavailable",
        ));
    }
    let stage = db.library_dir().join(format!(
        ".import-{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    db.managed_path(&stage)?;
    fs::create_dir_all(db.library_dir()).map_err(|e| walk::io(&db.library_dir(), "mkdir", e))?;
    journal.claim(db, &stage, None, false)?;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        process(db, journal, path, format, &stage, control, open)
    }))
    .unwrap_or_else(|_| {
        Err(AppError::new(
            ErrorCode::Internal,
            "Import pipeline panicked",
        ))
    });
    if let Err(e) = journal.reconcile(db) {
        log::error!("import journal cleanup: {e}");
    }
    result
}
fn process<R: Read>(
    db: &Database,
    journal: &mut Journal,
    path: &Path,
    format: &str,
    stage: &Path,
    control: &ImportControl<'_>,
    open: impl FnOnce() -> Result<R, AppError>,
) -> Result<(ImportOutcome, Option<BookRecord>), AppError> {
    let mut source = open()?;
    let closing = control.closing;
    let mut target = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(stage)
        .map_err(|e| walk::io(stage, "write", e))?;
    let mut hash = blake3::Hasher::new();
    let mut size = 0u64;
    let mut buffer = [0; 64 * 1024];
    loop {
        check_closing(closing)?;
        let count = source
            .read(&mut buffer)
            .map_err(|e| walk::io(path, "read", e))?;
        check_closing(closing)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > SAFE_INTEGER {
            return Err(walk::io(path, "read", "File exceeds safe integer size"));
        }
        hash.update(&buffer[..count]);
        target
            .write_all(&buffer[..count])
            .map_err(|e| walk::io(stage, "write", e))?;
    }
    check_closing(closing)?;
    target.sync_all().map_err(|e| walk::io(stage, "write", e))?;
    drop(target);
    if size == 0 {
        return Err(AppError::new(ErrorCode::ImportEmptyFile, "Empty book"));
    }
    let id = hash.finalize().to_hex()[..32].to_owned();
    let part = db.library_dir().join(format!(".{id}.{format}.part"));
    journal.claim(db, &part, Some(&id), false)?;
    fs::rename(stage, &part).map_err(|e| walk::io(&part, "rename", e))?;
    check_closing(closing)?;
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let (title, author, language, cover, metadata) = if format == "epub" {
        let meta = epub_meta::read(&part)?;
        (
            meta.title.unwrap_or_else(|| stem.to_string()),
            meta.author,
            meta.language,
            meta.cover,
            serde_json::json!({"restrictions":{"drm":meta.drm,"fixedLayout":meta.fixed}}),
        )
    } else {
        let (title, author) = txt_title::read(&part, &stem);
        (title, author, None, None, serde_json::json!({}))
    };
    check_closing(closing)?;
    let cover_stage = db
        .profile
        .covers
        .join(stage.file_name().expect("stage name"));
    let mut has_cover = false;
    if let Some(bytes) = cover {
        let destination = cover_stage.clone();
        // Cover failures, including unwritable/missing cover directories, are nonfatal.
        let result = (|| {
            db.managed_path(&destination).map_err(|e| e.message)?;
            fs::create_dir_all(&db.profile.covers).map_err(|e| e.to_string())?;
            journal
                .claim(db, &destination, None, false)
                .map_err(|e| e.message)?;
            covers::write(&bytes, &destination)
        })();
        match result {
            Ok(()) => has_cover = true,
            Err(e) => log::warn!("cover {id}: {e}"),
        }
    }
    // Copy, hash and parsing are complete; serialize only the publication.
    check_closing(closing)?;
    let book_lock = control.access.book(&id)?;
    let _commit = book_lock.lock().map_err(crate::db::db_error)?;
    check_closing(closing)?;
    control.access.check_import(&id, control.revision)?;
    match db.get(&id) {
        Ok(book) => {
            if book.file_missing {
                let destination = Path::new(&book.file_path);
                journal.claim(db, destination, Some(&id), true)?;
                check_closing(closing)?;
                fs::rename(&part, destination).map_err(|e| walk::io(destination, "rename", e))?;
            }
            return Ok((ImportOutcome::Duplicate, Some(db.get(&id)?)));
        }
        Err(e) if e.code == ErrorCode::BookNotFound => {}
        Err(e) => return Err(e),
    }
    let destination = db.library_dir().join(format!("{id}.{format}"));
    journal.claim(db, &destination, Some(&id), true)?;
    fs::rename(&part, &destination).map_err(|e| walk::io(&destination, "rename", e))?;
    if has_cover {
        let destination = db.profile.covers.join(format!("{id}.jpg"));
        let result = journal
            .claim(db, &destination, Some(&id), true)
            .and_then(|_| {
                fs::rename(&cover_stage, &destination)
                    .map_err(|e| walk::io(&destination, "rename", e))
            });
        if let Err(e) = result {
            log::warn!("cover {id}: {e}");
            has_cover = false;
        }
    }
    check_closing(closing)?;
    let book = db.insert(&NewBook {
        id,
        format: format.into(),
        title,
        author,
        language,
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        file_size: size,
        cover: has_cover,
        metadata,
    })?;
    Ok((ImportOutcome::Added, Some(book)))
}

fn check_closing(closing: &AtomicBool) -> Result<(), AppError> {
    if closing.load(Ordering::Acquire) {
        Err(crate::db::invalid("jobId", "Application is closing"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod concurrency_tests {
    use super::*;
    use std::{
        io::Cursor,
        sync::{Arc, mpsc},
        time::Duration,
    };

    struct BlockedRead {
        bytes: Cursor<Vec<u8>>,
        reads: usize,
        entered: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }
    impl Read for BlockedRead {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if self.reads == 1 {
                self.entered.send(()).unwrap();
                self.release.recv().unwrap();
            }
            self.reads += 1;
            self.bytes.read(buffer)
        }
    }
    fn fixture() -> (
        tempfile::TempDir,
        Arc<super::super::Library>,
        std::path::PathBuf,
        BookRecord,
    ) {
        let temp = tempfile::tempdir().unwrap();
        let profile = crate::profile::Profile::resolve(
            Some(temp.path().join("profile").into_os_string()),
            || panic!(),
        )
        .unwrap();
        let db = Database::open(profile.clone(), profile.root.join("library"));
        let source = temp.path().join("source.txt");
        fs::write(&source, vec![b'a'; 128 * 1024]).unwrap();
        let (_, book) = item(&db, &mut Journal::load(&db).unwrap(), &source).unwrap();
        (
            temp,
            Arc::new(super::super::Library::start(db, |_| {})),
            source,
            book.unwrap(),
        )
    }
    fn blocked_import(
        library: &Arc<super::super::Library>,
        source: &Path,
        bytes: Vec<u8>,
    ) -> (
        mpsc::Receiver<()>,
        mpsc::Sender<()>,
        std::thread::JoinHandle<Result<(ImportOutcome, Option<BookRecord>), AppError>>,
    ) {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let library = library.clone();
        let source = source.to_owned();
        let revision = library.access.revision();
        let worker = std::thread::spawn(move || {
            let mut journal = Journal::load(&library.db).unwrap();
            item_with_source(
                &library.db,
                &mut journal,
                &source,
                &ImportControl {
                    access: &library.access,
                    revision,
                    closing: &library.closing,
                },
                || {
                    Ok(BlockedRead {
                        bytes: Cursor::new(bytes),
                        reads: 0,
                        entered: entered_tx,
                        release: release_rx,
                    })
                },
            )
        });
        (entered_rx, release_tx, worker)
    }
    fn no_staging(db: &Database) {
        assert!(fs::read_dir(db.library_dir()).unwrap().all(|entry| {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            !name.ends_with(".tmp") && !name.ends_with(".part")
        }));
        let journal: serde_json::Value =
            serde_json::from_slice(&fs::read(db.profile.root.join("import-journal.json")).unwrap())
                .unwrap();
        assert_eq!(journal, serde_json::json!([]));
    }
    #[test]
    fn blocked_copy_allows_persistence_and_close_cleans_partial_copy() {
        let (_temp, library, source, book) = fixture();
        let (entered, release, import) = blocked_import(&library, &source, vec![b'b'; 128 * 1024]);
        entered.recv_timeout(Duration::from_secs(2)).unwrap();
        let (saved_tx, saved_rx) = mpsc::channel();
        let db = library.db.clone();
        let save = std::thread::spawn(move || {
            let result = db.position_save(&book.id, serde_json::json!({"sectionIndex":0,"cfi":null,"charOffset":7,"globalCharOffset":7,"progress":0.5,"snippet":"saved"}));
            saved_tx.send(result).unwrap();
        });
        let saved = saved_rx.recv_timeout(Duration::from_millis(1200));
        library.close();
        release.send(()).unwrap();
        let result = import.join().unwrap();
        save.join().unwrap();
        saved.expect("quit save waited for import I/O").unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::InvalidArgument);
        assert_eq!(library.db.list().unwrap().len(), 1);
        no_staging(&library.db);
    }
    #[test]
    fn removal_during_copy_cannot_be_republished_but_a_later_import_can_restore_it() {
        let (_temp, library, source, book) = fixture();
        let (entered, release, import) =
            blocked_import(&library, &source, fs::read(&source).unwrap());
        entered.recv_timeout(Duration::from_secs(2)).unwrap();
        let other = library.clone();
        let id = book.id.clone();
        let (removed_tx, removed_rx) = mpsc::channel();
        let removal = std::thread::spawn(move || removed_tx.send(other.remove(&[id])).unwrap());
        let removed = removed_rx.recv_timeout(Duration::from_millis(1200));
        release.send(()).unwrap();
        let result = import.join().unwrap();
        removal.join().unwrap();
        assert_eq!(
            removed
                .expect("remove waited for unrelated file copy")
                .unwrap()
                .removed_ids,
            [book.id.clone()]
        );
        assert_eq!(result.unwrap_err().code, ErrorCode::BookNotFound);
        assert!(library.db.list().unwrap().is_empty());
        assert!(!Path::new(&book.file_path).exists());
        no_staging(&library.db);
        // A subsequent explicit user import has a new acceptance revision.
        let (_, restored) = item_with_control(
            &library.db,
            &mut Journal::load(&library.db).unwrap(),
            &source,
            &ImportControl {
                access: &library.access,
                revision: library.access.revision(),
                closing: &library.closing,
            },
        )
        .unwrap();
        assert_eq!(restored.unwrap().id, book.id);
        library.close();
    }
}
