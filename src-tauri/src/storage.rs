use crate::{
    contract::{AppError, ErrorCode},
    profile::{canonical_future, is_reparse},
};
use std::{fs, io::Write, path::Path};
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
