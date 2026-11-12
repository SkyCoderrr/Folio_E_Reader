use crate::{
    contract::*,
    db::{db_error, validate_id},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, RwLock, Weak},
};

#[derive(Default)]
struct History {
    revision: u64,
    removed: HashMap<String, u64>,
    books: HashMap<String, Weak<Mutex<()>>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unrelated_books_do_not_share_a_file_work_lock() {
        let access = Arc::new(FileAccess::default());
        let held = access.book(&"a".repeat(32)).unwrap();
        let guard = held.lock().unwrap();
        let other = access.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            tx.send(other.with_books(&["b".repeat(32)], || Ok(())))
                .unwrap()
        });
        let result = rx.recv_timeout(std::time::Duration::from_millis(1200));
        drop(guard);
        worker.join().unwrap();
        result
            .expect("unrelated book waited for file work")
            .unwrap();
    }
}
/// Folder changes exclude file commands. Otherwise only commands for the same
/// content id coordinate; persistence never acquires either kind of guard.
#[derive(Default)]
pub struct FileAccess {
    pub(crate) root: RwLock<()>,
    history: Mutex<History>,
}
impl FileAccess {
    pub(super) fn revision(&self) -> u64 {
        self.history
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .revision
    }
    pub(super) fn book(&self, id: &str) -> Result<Arc<Mutex<()>>, AppError> {
        validate_id(id)?;
        let mut history = self.history.lock().map_err(db_error)?;
        if let Some(lock) = history.books.get(id).and_then(Weak::upgrade) {
            return Ok(lock);
        }
        history.books.retain(|_, lock| lock.strong_count() > 0);
        let lock = Arc::new(Mutex::new(()));
        history.books.insert(id.into(), Arc::downgrade(&lock));
        Ok(lock)
    }
    pub(super) fn check_import(&self, id: &str, accepted: u64) -> Result<(), AppError> {
        let history = self.history.lock().map_err(db_error)?;
        if history
            .removed
            .get(id)
            .is_some_and(|removed| *removed > accepted)
        {
            return Err(crate::db::missing(id));
        }
        Ok(())
    }
    pub(super) fn removed(&self, ids: &[String]) -> Result<(), AppError> {
        let mut history = self.history.lock().map_err(db_error)?;
        history.revision += 1;
        let revision = history.revision;
        for id in ids {
            history.removed.insert(id.clone(), revision);
        }
        Ok(())
    }
    pub fn with_books<T>(
        &self,
        ids: &[String],
        operation: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let _root = self.root.read().map_err(db_error)?;
        let mut ids = ids.to_vec();
        ids.sort();
        ids.dedup();
        let locks = ids
            .iter()
            .map(|id| self.book(id))
            .collect::<Result<Vec<_>, _>>()?;
        let _guards = locks
            .iter()
            .map(|lock| lock.lock().map_err(db_error))
            .collect::<Result<Vec<_>, _>>()?;
        operation()
    }
}
