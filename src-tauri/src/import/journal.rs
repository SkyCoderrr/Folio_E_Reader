use crate::{
    contract::*,
    db::{Database, db_error},
    storage::atomic_write,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    path: PathBuf,
    book_id: Option<String>,
    durable: bool,
}
pub struct Journal {
    path: PathBuf,
    entries: Vec<Entry>,
}
impl Journal {
    pub fn ensure_clean(&mut self, db: &Database) -> Result<(), AppError> {
        self.reconcile(db)?;
        if !self.entries.is_empty() {
            return Err(crate::storage::io_error(
                "Import staging cleanup must finish before changing library folder",
            ));
        }
        Ok(())
    }
    pub fn load(db: &Database) -> Result<Self, AppError> {
        let path = db.profile.root.join("import-journal.json");
        db.managed_path(&path)?;
        let entries = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(db_error)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(super::walk::io(&path, "read", e)),
        };
        let mut journal = Self { path, entries };
        if !db.library_offline() {
            journal.reconcile(db)?;
        }
        Ok(journal)
    }
    fn save(&self) -> Result<(), AppError> {
        atomic_write(
            &self.path,
            &serde_json::to_value(&self.entries).map_err(db_error)?,
        )
        .map_err(|e| super::walk::io(&self.path, "write", e))
    }
    pub fn claim(
        &mut self,
        db: &Database,
        path: &Path,
        id: Option<&str>,
        durable: bool,
    ) -> Result<(), AppError> {
        db.managed_path(path)?;
        if path
            .try_exists()
            .map_err(|e| super::walk::io(path, "write", e))?
        {
            return Err(super::walk::io(
                path,
                "write",
                "Refusing to overwrite an unowned file",
            ));
        }
        self.entries.push(Entry {
            path: path.to_owned(),
            book_id: id.map(str::to_owned),
            durable,
        });
        self.save()
    }
    fn validate(db: &Database, entry: &Entry) -> Result<(), AppError> {
        db.managed_path(&entry.path)?;
        let name = entry
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| db_error("Bad journal name"))?;
        let valid = if let Some(id) = &entry.book_id {
            crate::db::validate_id(id).map_err(db_error)?;
            (entry.path.parent() == Some(db.library_dir().as_path())
                && [
                    format!("{id}.epub"),
                    format!("{id}.txt"),
                    format!(".{id}.epub.part"),
                    format!(".{id}.txt.part"),
                ]
                .contains(&name.to_owned()))
                || entry.path == db.profile.covers.join(format!("{id}.jpg"))
        } else {
            entry.path.parent() == Some(db.library_dir().as_path())
                && name.starts_with(".import-")
                && name.ends_with(".tmp")
        };
        if !valid {
            return Err(db_error("Journal path is outside generated layout"));
        }
        Ok(())
    }
    pub fn reconcile(&mut self, db: &Database) -> Result<(), AppError> {
        // Validate the entire journal before deleting anything.
        for entry in &self.entries {
            Self::validate(db, entry)?;
        }
        let mut remaining = Vec::new();
        for entry in &self.entries {
            let keep = if entry.durable {
                if let Some(id) = &entry.book_id {
                    match db.get(id) {
                        Ok(book) => {
                            entry.path == Path::new(&book.file_path)
                                || book
                                    .cover_path
                                    .as_ref()
                                    .is_some_and(|p| entry.path == Path::new(p))
                        }
                        Err(e) if e.code == ErrorCode::BookNotFound => false,
                        Err(e) => return Err(e),
                    }
                } else {
                    false
                }
            } else {
                false
            };
            if !keep
                && let Err(e) = fs::remove_file(&entry.path)
                && e.kind() != std::io::ErrorKind::NotFound
            {
                log::error!("import cleanup {}: {e}", entry.path.display());
                remaining.push(entry.clone());
            }
        }
        self.entries = remaining;
        self.save()
    }
}
