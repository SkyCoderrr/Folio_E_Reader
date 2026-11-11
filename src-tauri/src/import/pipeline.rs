use super::{covers, epub_meta, journal::Journal, txt_title, walk};
use crate::{
    contract::*,
    db::{Database, NewBook, SAFE_INTEGER},
};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn item(
    db: &Database,
    journal: &mut Journal,
    path: &Path,
) -> Result<(ImportOutcome, Option<BookRecord>), AppError> {
    db.profile.validate_library(&db.library_dir())?;
    item_with_commit(db, journal, path, &std::sync::Mutex::new(()))
}
pub(crate) fn item_with_commit(
    db: &Database,
    journal: &mut Journal,
    path: &Path,
    mutation: &std::sync::Mutex<()>,
) -> Result<(ImportOutcome, Option<BookRecord>), AppError> {
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
        process(db, journal, path, format, &stage, mutation)
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
fn process(
    db: &Database,
    journal: &mut Journal,
    path: &Path,
    format: &str,
    stage: &Path,
    mutation: &std::sync::Mutex<()>,
) -> Result<(ImportOutcome, Option<BookRecord>), AppError> {
    let mut source = File::open(path).map_err(|e| walk::io(path, "read", e))?;
    let mut target = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(stage)
        .map_err(|e| walk::io(stage, "write", e))?;
    let mut hash = blake3::Hasher::new();
    let mut size = 0u64;
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|e| walk::io(path, "read", e))?;
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
    target.sync_all().map_err(|e| walk::io(stage, "write", e))?;
    drop(target);
    if size == 0 {
        return Err(AppError::new(ErrorCode::ImportEmptyFile, "Empty book"));
    }
    let id = hash.finalize().to_hex()[..32].to_owned();
    let part = db.library_dir().join(format!(".{id}.{format}.part"));
    journal.claim(db, &part, Some(&id), false)?;
    fs::rename(stage, &part).map_err(|e| walk::io(&part, "rename", e))?;
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
    let mut has_cover = false;
    if let Some(bytes) = cover {
        let destination = db.profile.covers.join(format!("{id}.jpg"));
        // Cover failures, including unwritable/missing cover directories, are nonfatal.
        let result = (|| {
            db.managed_path(&destination).map_err(|e| e.message)?;
            fs::create_dir_all(&db.profile.covers).map_err(|e| e.to_string())?;
            journal
                .claim(db, &destination, Some(&id), true)
                .map_err(|e| e.message)?;
            covers::write(&bytes, &destination)
        })();
        match result {
            Ok(()) => has_cover = true,
            Err(e) => log::warn!("cover {id}: {e}"),
        }
    }
    // Copy, hash and parsing are complete; serialize only the publication.
    let _commit = mutation.lock().map_err(crate::db::db_error)?;
    match db.get(&id) {
        Ok(book) => {
            if book.file_missing {
                let destination = Path::new(&book.file_path);
                journal.claim(db, destination, Some(&id), true)?;
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
