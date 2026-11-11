use crate::{contract::AppError, storage::io_error};
use std::{fs, path::Path};
// v1 is the only published schema. Future migrations are pure Value -> Value steps here.
pub fn backup(path: &Path, version: u64) -> Result<(), AppError> {
    let backup = path.with_file_name(format!("settings.json.bak-v{version}"));
    if !backup.exists() {
        fs::copy(path, backup).map_err(io_error)?;
    }
    log::warn!("Loading settings v{version} as v1; original backed up");
    Ok(())
}
