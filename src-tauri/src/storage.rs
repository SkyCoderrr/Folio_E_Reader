use crate::{
    contract::{AppError, ErrorCode},
    profile::{canonical_future, is_reparse},
};
use std::{fs, io::Write, path::Path};

type Update<T> = Box<dyn FnOnce(&mut T) + Send>;
/// One writer owns persistence. Readers only lock an in-memory snapshot; no lock
/// is held while an update validates, writes, fsyncs or renames files.
pub struct SnapshotStore<T> {
    snapshot: std::sync::Arc<std::sync::Mutex<T>>,
    sender: std::sync::mpsc::Sender<Update<T>>,
}
impl<T: Clone + Send + 'static> SnapshotStore<T> {
    pub fn new(initial: T) -> Self {
        let snapshot = std::sync::Arc::new(std::sync::Mutex::new(initial.clone()));
        let (sender, receiver) = std::sync::mpsc::channel::<Update<T>>();
        std::thread::spawn(move || {
            let mut current = initial;
            for update in receiver {
                update(&mut current);
            }
        });
        Self { snapshot, sender }
    }
    pub fn snapshot(&self) -> Result<T, AppError> {
        self.snapshot.lock().map(|v| v.clone()).map_err(io_error)
    }
    /// Called on a blocking worker. Only successful updates publish a snapshot.
    pub fn update<R: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut T) -> Result<R, AppError> + Send + 'static,
    ) -> Result<R, AppError> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let published = self.snapshot.clone();
        self.sender
            .send(Box::new(move |current| {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let mut candidate = current.clone();
                    let result = operation(&mut candidate);
                    if result.is_ok() {
                        let snapshot = candidate.clone();
                        *published.lock().unwrap_or_else(|e| e.into_inner()) = snapshot;
                        *current = candidate;
                    }
                    result
                }))
                .unwrap_or_else(|_| {
                    Err(AppError::new(
                        ErrorCode::Internal,
                        "Snapshot update panicked",
                    ))
                });
                let _ = sender.send(result);
            }))
            .map_err(io_error)?;
        receiver.recv().map_err(io_error)?
    }
}
pub fn io_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::IoError, error.to_string())
}
pub fn atomic_write(path: &Path, value: &serde_json::Value) -> Result<(), AppError> {
    if path.exists() && is_reparse(path)? {
        return Err(io_error("Refusing persistence reparse point"));
    }
    let temporary = path.with_file_name(format!(
        "{}.tmp",
        path.file_name().unwrap().to_string_lossy()
    ));
    if temporary.exists() && is_reparse(&temporary)? {
        return Err(io_error("Refusing temporary reparse point"));
    }
    if canonical_future(path)?.parent() != canonical_future(&temporary)?.parent() {
        return Err(io_error("Atomic write parent mismatch"));
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)
        .map_err(io_error)?;
    let mut bytes = serde_json::to_vec_pretty(value).map_err(io_error)?;
    bytes.push(b'\n');
    file.write_all(&bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    drop(file);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            Win32::Storage::FileSystem::{
                MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
            },
            core::PCWSTR,
        };
        let src: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let dst: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                PCWSTR(src.as_ptr()),
                PCWSTR(dst.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(io_error)?;
    }
    #[cfg(not(windows))]
    fs::rename(temporary, path).map_err(io_error)?;
    Ok(())
}
pub fn quarantine(path: &Path) -> Result<(), AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(io_error)?
        .as_millis();
    fs::rename(
        path,
        path.with_file_name(format!(
            "{}.corrupt-{now}",
            path.file_name().unwrap().to_string_lossy()
        )),
    )
    .map_err(io_error)
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    use std::sync::{Arc, mpsc};
    #[test]
    fn settings_reads_remain_available_and_serial_writes_merge_during_persistence() {
        let temp = tempfile::tempdir().unwrap();
        let profile = crate::profile::Profile::resolve(
            Some(temp.path().join("profile").into_os_string()),
            || panic!(),
        )
        .unwrap();
        let initial = crate::settings::load(&profile, || panic!()).unwrap();
        let store = Arc::new(SnapshotStore::new(initial));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = store.clone();
        let path = profile.settings.clone();
        let a = std::thread::spawn(move || {
            first.update(move |candidate| {
                candidate.effective.stats.enabled = false;
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                candidate.write(&path)
            })
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let read = store.clone();
        let (read_tx, read_rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            read_tx
                .send(read.snapshot().unwrap().effective.stats.enabled)
                .unwrap()
        });
        let during = read_rx.recv_timeout(std::time::Duration::from_millis(1200));
        let second = store.clone();
        let folder = temp.path().join("custom");
        let path = profile.settings.clone();
        let b = std::thread::spawn(move || {
            second.update(move |candidate| {
                candidate.effective.library.folder = Some(folder.to_string_lossy().into_owned());
                candidate.library_dir = folder;
                candidate.write(&path)
            })
        });
        release_tx.send(()).unwrap();
        a.join().unwrap().unwrap();
        b.join().unwrap().unwrap();
        reader.join().unwrap();
        assert!(during.expect("settings read waited for persistence"));
        let live = store.snapshot().unwrap();
        assert!(!live.effective.stats.enabled);
        assert!(live.effective.library.folder.is_some());
        assert_eq!(
            crate::settings::load(&profile, || panic!())
                .unwrap()
                .effective,
            live.effective
        );
    }
    #[test]
    fn failed_update_does_not_publish_partial_settings() {
        let store = SnapshotStore::new(serde_json::json!({"saved":1}));
        assert!(
            store
                .update::<()>(|v| {
                    v["saved"] = serde_json::json!(2);
                    Err(io_error("disk failure"))
                })
                .is_err()
        );
        assert_eq!(store.snapshot().unwrap(), serde_json::json!({"saved":1}));
        store
            .update(|v| {
                assert_eq!(v["saved"], 1);
                Ok(())
            })
            .unwrap();
    }
}

#[cfg(test)]
mod panic_tests {
    use super::*;
    #[test]
    fn panicking_update_returns_internal_and_writer_retains_last_good_state() {
        let store = SnapshotStore::new(vec![1]);
        let error = store
            .update::<()>(|candidate| {
                candidate.push(2);
                panic!("regression: update panicked");
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
        assert_eq!(store.snapshot().unwrap(), [1]);
        store
            .update(|candidate| {
                candidate.push(3);
                Ok(())
            })
            .unwrap();
        assert_eq!(store.snapshot().unwrap(), [1, 3]);
    }
}
