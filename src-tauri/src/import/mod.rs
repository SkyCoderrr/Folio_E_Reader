mod covers;
pub mod epub_meta;
pub mod journal;
pub mod pipeline;
pub mod txt_title;
pub mod walk;
use crate::{
    contract::*,
    db::{Database, invalid},
};
use std::{
    collections::HashSet,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};

pub enum ImportEvent {
    Item(Box<ImportItemPayload>),
    Done(ImportDonePayload),
}
struct Queue {
    sender: mpsc::Sender<LibraryImportArgs>,
    accepted: HashSet<String>,
}
pub struct Library {
    pub db: Arc<Database>,
    pub mutation: Arc<Mutex<()>>,
    queue: Mutex<Queue>,
    closing: Arc<AtomicBool>,
    startup: Result<(), AppError>,
    pending: Arc<(Mutex<usize>, std::sync::Condvar)>,
    journal: Option<Arc<Mutex<journal::Journal>>>,
}
impl Library {
    pub fn start(db: Database, emit: impl Fn(ImportEvent) + Send + 'static) -> Self {
        let db = Arc::new(db);
        let mutation = Arc::new(Mutex::new(()));
        let closing = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::channel::<LibraryImportArgs>();
        let pending = Arc::new((Mutex::new(0usize), std::sync::Condvar::new()));
        let journal = db
            .available()
            .and_then(|_| journal::Journal::load(&db).map_err(crate::db::db_error));
        let startup = journal.as_ref().map(|_| ()).map_err(Clone::clone);
        if let Err(e) = &startup {
            log::error!("library startup: {e}");
        }
        let journal = journal.ok().map(|journal| Arc::new(Mutex::new(journal)));
        if let Some(journal) = journal.clone() {
            let pending = pending.clone();
            let (db, mutation, closing) = (db.clone(), mutation.clone(), closing.clone());
            std::thread::spawn(move || {
                for args in receiver {
                    if closing.load(Ordering::Acquire) {
                        break;
                    }
                    run_job_until(
                        &db,
                        &mutation,
                        &mut journal.lock().unwrap_or_else(|e| e.into_inner()),
                        args,
                        &emit,
                        &closing,
                    );
                    let mut count = pending.0.lock().unwrap_or_else(|e| e.into_inner());
                    *count -= 1;
                    pending.1.notify_all();
                }
            });
        }
        Self {
            db,
            mutation,
            queue: Mutex::new(Queue {
                sender,
                accepted: HashSet::new(),
            }),
            closing,
            startup,
            pending,
            journal,
        }
    }
    /// The caller holds with_idle; a failed staging cleanup must not strand an old-root journal.
    pub fn prepare_folder_change(&self) -> Result<(), AppError> {
        self.startup.clone()?;
        if let Some(journal) = &self.journal {
            journal
                .lock()
                .map_err(crate::storage::io_error)?
                .ensure_clean(&self.db)?;
        }
        Ok(())
    }
    /// Block admission of new jobs, drain whole accepted jobs, then take the shared mutation lock.
    pub fn with_idle<T>(
        &self,
        operation: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let _queue = self.queue.lock().map_err(crate::db::db_error)?;
        self.startup.clone()?;
        if self.closing.load(Ordering::Acquire) {
            return Err(invalid("path", "Application is closing"));
        }
        let count = self.pending.0.lock().map_err(crate::db::db_error)?;
        let count = self
            .pending
            .1
            .wait_while(count, |count| {
                *count > 0 && !self.closing.load(Ordering::Acquire)
            })
            .map_err(crate::db::db_error)?;
        drop(count);
        if self.closing.load(Ordering::Acquire) {
            return Err(invalid("path", "Application is closing"));
        }
        let _mutation = self.mutation.lock().map_err(crate::db::db_error)?;
        operation()
    }
    pub fn close(&self) {
        let _pending = self.pending.0.lock().unwrap_or_else(|e| e.into_inner());
        self.closing.store(true, Ordering::Release);
        self.pending.1.notify_all();
    }
    pub fn checkpoint(&self) {
        if let Err(e) = self.db.with(|c| {
            c.execute_batch("PRAGMA wal_checkpoint(PASSIVE)")
                .map_err(crate::db::db_error)
        }) {
            log::error!("shutdown database checkpoint: {e}");
        }
    }
    pub fn enqueue(&self, job_id: String, paths: Vec<String>) -> Result<(), AppError> {
        if job_id.is_empty()
            || job_id.len() > 64
            || !job_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
        {
            return Err(invalid(
                "jobId",
                "Expected 1..64 ASCII letters, digits, underscores or hyphens",
            ));
        }
        if paths.is_empty()
            || paths.len() > 10000
            || paths
                .iter()
                .any(|p| !std::path::Path::new(p).is_absolute() || p.contains('\0'))
        {
            return Err(invalid("paths", "Expected 1..10000 absolute paths"));
        }
        self.db.available()?;
        if self.db.library_offline() {
            return Err(AppError::new(
                ErrorCode::LibraryFolderInvalid,
                "Library folder is unavailable",
            ));
        }
        self.startup.clone()?;
        let mut queue = self.queue.lock().map_err(crate::db::db_error)?;
        if self.closing.load(Ordering::Acquire) {
            return Err(invalid("jobId", "Application is closing"));
        }
        if queue.accepted.contains(&job_id) {
            return Err(invalid("jobId", "Job id was already accepted"));
        }
        let mut pending = self.pending.0.lock().map_err(crate::db::db_error)?;
        queue
            .sender
            .send(LibraryImportArgs {
                job_id: job_id.clone(),
                paths,
            })
            .map_err(crate::db::db_error)?;
        *pending += 1;
        queue.accepted.insert(job_id);
        Ok(())
    }
}
pub fn run_job(
    db: &Database,
    mutation: &Mutex<()>,
    journal: &mut journal::Journal,
    args: LibraryImportArgs,
    emit: &impl Fn(ImportEvent),
) {
    run_job_until(db, mutation, journal, args, emit, &AtomicBool::new(false));
}
pub fn run_job_until(
    db: &Database,
    mutation: &Mutex<()>,
    journal: &mut journal::Journal,
    args: LibraryImportArgs,
    emit: &impl Fn(ImportEvent),
    closing: &AtomicBool,
) {
    let root_check = db.profile.validate_library(&db.library_dir()).map(|root| {
        let _ = crate::profile::library_files(&root);
    });
    let candidates = walk::enumerate(&args.paths);
    let total = candidates.len() as u32;
    let mut done = ImportDonePayload {
        job_id: args.job_id.clone(),
        total,
        added: 0,
        duplicates: 0,
        unsupported: Vec::new(),
        failed: Vec::new(),
    };
    for (index, candidate) in candidates.into_iter().enumerate() {
        if closing.load(Ordering::Acquire) {
            break;
        }
        let path = candidate.path.to_string_lossy().into_owned();
        let file_name = candidate
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let result = candidate.error.map_or_else(
            || {
                root_check.clone()?;
                // A failed item must never unwind the worker and lose completion.
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    pipeline::item_with_commit(db, journal, &candidate.path, mutation)
                }))
                .unwrap_or_else(|_| {
                    Err(AppError::new(ErrorCode::Internal, "Import worker panicked"))
                })
            },
            Err,
        );
        let (outcome, book, error) = match result {
            Ok((outcome, book)) => {
                match outcome {
                    ImportOutcome::Added => done.added += 1,
                    ImportOutcome::Duplicate => done.duplicates += 1,
                    _ => done.unsupported.push(file_name.clone()),
                }
                (outcome, book, None)
            }
            Err(e) => {
                log::error!("library_import {}: {e}", candidate.path.display());
                done.failed.push(ImportFailure {
                    path: path.clone(),
                    file_name: file_name.clone(),
                    error: e.clone(),
                });
                (ImportOutcome::Failed, None, Some(e))
            }
        };
        emit(ImportEvent::Item(Box::new(ImportItemPayload {
            job_id: args.job_id.clone(),
            index: index as u32,
            total,
            path,
            file_name,
            outcome,
            book,
            error,
        })));
    }
    emit(ImportEvent::Done(done));
}

#[cfg(test)]
mod batch2_tests {
    use super::*;
    #[test]
    fn validates_tree_once_per_job_and_closing_stops_admission() {
        let temp = tempfile::tempdir().unwrap();
        let profile = crate::profile::Profile::resolve(
            Some(temp.path().join("profile").into_os_string()),
            || panic!(),
        )
        .unwrap();
        let db = Database::open(profile.clone(), profile.root.join("library"));
        let mut paths = Vec::new();
        for n in 0..3 {
            let path = temp.path().join(format!("{n}.txt"));
            std::fs::write(&path, format!("book {n}")).unwrap();
            paths.push(path.to_string_lossy().into_owned());
        }
        crate::profile::LIBRARY_SCANS.with(|count| count.set(0));
        let closing = AtomicBool::new(false);
        let seen = std::cell::Cell::new(0);
        run_job_until(
            &db,
            &Mutex::new(()),
            &mut journal::Journal::load(&db).unwrap(),
            LibraryImportArgs {
                job_id: "close".into(),
                paths,
            },
            &|event| {
                if matches!(event, ImportEvent::Item(_)) {
                    seen.set(seen.get() + 1);
                    closing.store(true, Ordering::Release);
                }
            },
            &closing,
        );
        assert_eq!(seen.get(), 1);
        assert_eq!(db.list().unwrap().len(), 1);
        crate::profile::LIBRARY_SCANS.with(|count| assert_eq!(count.get(), 1));
    }
}
