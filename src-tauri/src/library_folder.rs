use crate::{
    contract::*,
    db::Database,
    profile::{Profile, within},
    settings::LoadedSettings,
    storage::io_error,
};
use std::{fs, io, path::Path};

/// Called only under Library::with_idle, so imports, readers and removal see one root.
pub fn change(
    profile: &Profile,
    db: &Database,
    settings: &mut LoadedSettings,
    path: Option<&str>,
    move_files: bool,
    default: &Path,
    grant: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<LibrarySetFolderResult, AppError> {
    change_with_commit(
        profile,
        db,
        settings,
        path,
        move_files,
        default,
        grant,
        |candidate| candidate.write(&profile.settings),
    )
}
/// The commit callback runs before file moves; it merges only the managed folder fields.
#[allow(clippy::too_many_arguments)] // Existing folder-change inputs plus a short settings commit callback.
pub fn change_with_commit(
    profile: &Profile,
    db: &Database,
    settings: &mut LoadedSettings,
    path: Option<&str>,
    move_files: bool,
    default: &Path,
    grant: impl FnOnce(&Path) -> Result<(), AppError>,
    commit: impl FnOnce(&LoadedSettings) -> Result<(), AppError>,
) -> Result<LibrarySetFolderResult, AppError> {
    let destination = profile.validate_library(path.map(Path::new).unwrap_or(default))?;
    db.available()?;
    let mut result = LibrarySetFolderResult {
        library_dir: destination.to_string_lossy().into_owned(),
        moved: 0,
        failed: Vec::new(),
    };
    let same =
        within(&destination, &settings.library_dir) && within(&settings.library_dir, &destination);
    let folder = if within(&destination, default) && within(default, &destination) {
        None
    } else {
        Some(result.library_dir.clone())
    };
    if same && settings.effective.library.folder == folder {
        return Ok(result);
    }
    let books = db.list()?;
    let invalid = |error: io::Error| {
        AppError::new(ErrorCode::LibraryFolderInvalid, error.to_string())
            .with_details(serde_json::json!({"path":destination,"reason":error.to_string()}))
    };
    fs::create_dir_all(&destination).map_err(invalid)?;
    // Probe without overwriting any existing file, then revalidate before granting.
    let probe = destination.join(format!(".ereader-probe-{}", std::process::id()));
    drop(
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(invalid)?,
    );
    fs::remove_file(&probe).map_err(invalid)?;
    if !same && move_files {
        for book in &books {
            let target = destination.join(
                Path::new(&book.file_path)
                    .file_name()
                    .expect("validated book path"),
            );
            if target.try_exists().map_err(invalid)? {
                return Err(AppError::new(ErrorCode::LibraryFolderInvalid, "Destination contains a conflicting book file")
                    .with_details(serde_json::json!({"path":destination,"reason":"Destination contains a conflicting book file"})));
            }
        }
    }
    profile.validate_library(&destination)?;
    grant(&destination)?;
    let mut candidate = LoadedSettings {
        effective: settings.effective.clone(),
        raw: settings.raw.clone(),
        library_dir: destination.clone(),
    };
    candidate.effective.library.folder = folder;
    // Commit settings before moving: after this point every per-file failure is returned, never a command rejection.
    commit(&candidate)?;
    *settings = candidate;
    db.set_library_dir(destination.clone());
    db.require_existing_library(settings.effective.library.folder.is_some());
    if move_files && !same {
        for book in books {
            let source = Path::new(&book.file_path);
            let target = destination.join(source.file_name().expect("validated managed book path"));
            let moved = db
                .managed_path(source)
                .and_then(|_| db.managed_path(&target))
                .and_then(|_| move_owned(source, &target).map_err(io_error));
            match moved {
                Ok(()) => result.moved += 1,
                Err(error) => result.failed.push(FileError {
                    book_id: book.id,
                    message: error.message,
                }),
            }
        }
    }
    Ok(result)
}

fn move_owned(source: &Path, target: &Path) -> io::Result<()> {
    // Both paths were reparse-checked. No replacement flag: never overwrite an unowned file.
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            Win32::Storage::FileSystem::{MOVE_FILE_FLAGS, MoveFileExW},
            core::PCWSTR,
        };
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        match unsafe {
            MoveFileExW(
                PCWSTR(source.as_ptr()),
                PCWSTR(target.as_ptr()),
                MOVE_FILE_FLAGS(0),
            )
        } {
            Ok(()) => return Ok(()),
            Err(error) if error.code() == windows::core::HRESULT::from_win32(17) => (),
            Err(error) => {
                return Err(io::Error::from_raw_os_error(error.code().0 & 0xffff));
            }
        }
    }
    #[cfg(not(windows))]
    if fs::hard_link(source, target).is_ok() {
        return fs::remove_file(source);
    }
    {
        let mut input = fs::File::open(source)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)?;
        if let Err(error) = io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = fs::remove_file(target);
            return Err(error);
        }
    }
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    Ok(())
}
