mod bookmarks;
mod chapters;
mod epub_chars;
pub mod migrations;
pub(crate) mod positions;
mod repo;
use crate::{contract::*, profile::Profile};
pub use repo::NewBook;
use rusqlite::Connection;
use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

pub const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub fn db_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::DbError, error.to_string())
        .with_details(serde_json::json!({"sqliteCode":null}))
}
pub fn invalid(field: &str, reason: &str) -> AppError {
    AppError::new(ErrorCode::InvalidArgument, reason)
        .with_details(serde_json::json!({"field":field,"reason":reason}))
}
pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.len() != 32
        || !id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(invalid(
            "bookId",
            "Expected 32 lowercase hexadecimal characters",
        ));
    }
    Ok(())
}
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub fn missing(id: &str) -> AppError {
    AppError::new(ErrorCode::BookNotFound, "Book not found")
        .with_details(serde_json::json!({"bookId":id}))
}

pub struct Database {
    connection: Mutex<Result<Connection, AppError>>,
    pub profile: Profile,
    library: std::sync::RwLock<PathBuf>,
    library_requires_existing: std::sync::atomic::AtomicBool,
}
impl Database {
    // Keep a persistent availability error so the shell/settings still start.
    pub fn open(profile: Profile, library: PathBuf) -> Self {
        let connection = migrations::open(&profile.database);
        if let Err(e) = &connection {
            log::error!("database startup: {e}");
        }
        Self {
            connection: Mutex::new(connection),
            profile,
            library: std::sync::RwLock::new(library),
            library_requires_existing: std::sync::atomic::AtomicBool::new(false),
        }
    }
    pub fn library_dir(&self) -> PathBuf {
        self.library
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    pub(crate) fn set_library_dir(&self, path: PathBuf) {
        *self.library.write().unwrap_or_else(|e| e.into_inner()) = path;
    }
    fn lock(&self) -> Result<MutexGuard<'_, Result<Connection, AppError>>, AppError> {
        let guard = self.connection.lock().map_err(db_error)?;
        if let Err(e) = &*guard {
            return Err(e.clone());
        }
        Ok(guard)
    }
    pub fn with<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut guard = self.lock()?;
        operation(guard.as_mut().map_err(|e| e.clone())?)
    }
    pub fn available(&self) -> Result<(), AppError> {
        self.with(|_| Ok(()))
    }
    pub fn library_offline(&self) -> bool {
        self.profile.validate_library(&self.library_dir()).is_err() || !self.import_root_available()
    }
    pub(crate) fn import_root_available(&self) -> bool {
        let root = self.library_dir();
        match std::fs::read_dir(&root) {
            Ok(_) => true,
            Err(e)
                if e.kind() == std::io::ErrorKind::NotFound
                    && !self
                        .library_requires_existing
                        .load(std::sync::atomic::Ordering::Acquire) =>
            {
                // A fresh default library may be created, but its existing ancestor
                // must be accessible. Existing unreadable/default roots are offline too.
                let empty = self
                    .with(|c| {
                        c.query_row("SELECT NOT EXISTS(SELECT 1 FROM books)", [], |r| {
                            r.get::<_, bool>(0)
                        })
                        .map_err(db_error)
                    })
                    .unwrap_or(false);
                empty
                    && root
                        .ancestors()
                        .skip(1)
                        .find(|p| p.exists())
                        .is_some_and(|p| std::fs::read_dir(p).is_ok())
            }
            Err(_) => false,
        }
    }
    pub fn require_existing_library(&self, required: bool) {
        self.library_requires_existing
            .store(required, std::sync::atomic::Ordering::Release);
    }
    pub fn managed_path(&self, path: &std::path::Path) -> Result<PathBuf, AppError> {
        crate::profile::ensure_no_reparse(path).map_err(db_error)?;
        let resolved = crate::profile::canonical_future(path).map_err(db_error)?;
        // Reject any reparse redirect, even to another managed file.
        if resolved != path {
            return Err(db_error("Managed path is redirected"));
        }
        Ok(resolved)
    }
}

mod stats;
