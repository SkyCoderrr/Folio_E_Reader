use crate::contract::{AppError, ErrorCode};
use std::{
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct Profile {
    pub root: PathBuf,
    pub is_test: bool,
    pub settings: PathBuf,
    pub database: PathBuf,
    pub kv: PathBuf,
    pub logs: PathBuf,
    pub webview: PathBuf,
    pub cache: PathBuf,
    pub covers: PathBuf,
    pub window_state: PathBuf,
}
fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::IoError, message)
}
impl Profile {
    // The caller passes the environment exactly once. None alone selects the real profile.
    pub fn resolve(
        override_dir: Option<OsString>,
        real_root: impl FnOnce() -> Result<PathBuf, AppError>,
    ) -> Result<Self, AppError> {
        let is_test = override_dir.is_some();
        let path = match override_dir {
            Some(value) => {
                let text = value
                    .to_str()
                    .ok_or_else(|| invalid("Profile is not valid Unicode"))?;
                if text.trim().is_empty()
                    || text.chars().any(|c| c.is_control())
                    || text.starts_with(r"\\")
                {
                    return Err(invalid(
                        "Profile override must be a nonempty absolute local drive path",
                    ));
                }
                PathBuf::from(text)
            }
            None => real_root()?,
        };
        if !path.is_absolute() {
            return Err(invalid("Profile must be absolute"));
        }
        check_local(&path)?;
        // Resolve existing ancestors before creating anything beneath a mapped/junction target.
        check_local(&canonical_future(&path)?)?;
        fs::create_dir_all(&path).map_err(|e| invalid(e.to_string()))?;
        let root = canonical(&path)?;
        check_local(&root)?;
        let probe = root.join(format!(".write-probe-{}", std::process::id()));
        let probe_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|e| invalid(e.to_string()))?;
        drop(probe_file);
        fs::remove_file(probe).map_err(|e| invalid(e.to_string()))?;
        let profile = Self {
            settings: root.join("settings.json"),
            database: root.join("library.db"),
            kv: root.join("kv.json"),
            logs: root.join("logs"),
            webview: root.join("webview"),
            cache: root.join("cache"),
            covers: root.join("library/covers"),
            window_state: root.join("window-state.json"),
            root,
            is_test,
        };
        // Refuse internal persistence aliases, including aliases back to the profile root.
        for item in [
            &profile.settings,
            &profile.database,
            &profile.kv,
            &profile.logs,
            &profile.webview,
            &profile.cache,
            &profile.covers,
            &profile.window_state,
        ] {
            let resolved = canonical_future(item)?;
            if !within(&resolved, item) || !within(item, &resolved) {
                return Err(invalid(
                    "Profile persistence paths cannot alias other locations",
                ));
            }
        }
        for dir in [&profile.logs, &profile.webview, &profile.cache] {
            fs::create_dir_all(dir).map_err(|e| invalid(e.to_string()))?;
        }
        Ok(profile)
    }
    pub fn key(&self) -> String {
        format!(
            "com.dany.ereader.{}",
            &blake3::hash(self.root.to_string_lossy().to_lowercase().as_bytes()).to_hex()[..16]
        )
    }
    pub fn default_library(
        &self,
        documents: impl FnOnce() -> Result<PathBuf, AppError>,
    ) -> Result<PathBuf, AppError> {
        if self.is_test {
            Ok(self.root.join("library"))
        } else {
            Ok(documents()?.join("E_Reader Library"))
        }
    }
    pub fn validate_library(&self, path: &Path) -> Result<PathBuf, AppError> {
        let failure = |reason: &str| {
            AppError::new(ErrorCode::LibraryFolderInvalid, reason)
                .with_details(serde_json::json!({"path":path,"reason":reason}))
        };
        let text = path.to_string_lossy();
        if !path.is_absolute()
            || text.chars().any(|c| c.is_control())
            || text.starts_with(r"\\?\")
            || text.starts_with(r"\\.\")
        {
            return Err(failure("Invalid absolute library path"));
        }
        #[cfg(windows)]
        if !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::UNC(_, _)))
        {
            return Err(failure("Expected a drive path or UNC server and share"));
        }
        ensure_no_reparse(path)
            .map_err(|_| failure("Library path is unavailable or contains a reparse point"))?;
        let resolved =
            canonical_future(path).map_err(|_| failure("Cannot resolve library path"))?;
        if within(&self.root, &resolved)
            || within(&resolved, &self.cache)
            || within(&resolved, &self.covers)
        {
            return Err(failure("Library grant would expose protected profile data"));
        }
        if resolved.exists() {
            if !resolved.is_dir() {
                return Err(failure("Library is not a directory"));
            }
        }
        Ok(resolved)
    }
}
#[cfg(test)]
thread_local! { pub(crate) static LIBRARY_SCANS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
/// Inspect once at grant/job admission; never follow or grant unsafe entries.
pub fn library_files(root: &Path) -> Vec<PathBuf> {
    #[cfg(test)]
    LIBRARY_SCANS.with(|count| count.set(count.get() + 1));
    walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| match is_reparse(entry.path()) {
            Ok(false) => true,
            result => {
                log::warn!(
                    "Skipping library entry {}: {:?}",
                    entry.path().display(),
                    result
                );
                false
            }
        })
        .filter_map(|entry| match entry {
            Ok(entry) if entry.file_type().is_file() => match fs::File::open(entry.path()) {
                Ok(_) => Some(entry.into_path()),
                Err(e) => {
                    log::warn!(
                        "Skipping unreadable library file {}: {e}",
                        entry.path().display()
                    );
                    None
                }
            },
            Ok(_) => None,
            Err(e) => {
                log::warn!("Skipping unreadable library entry: {e}");
                None
            }
        })
        .collect()
}
/// Check components without resolving through junctions, including dangling links.
pub fn ensure_no_reparse(path: &Path) -> Result<(), AppError> {
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(_) if is_reparse(&current)? => {
                return Err(invalid("Library path contains a reparse point"));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(invalid(e.to_string())),
        }
    }
    Ok(())
}
pub fn canonical(path: &Path) -> Result<PathBuf, AppError> {
    let path = fs::canonicalize(path).map_err(|e| invalid(e.to_string()))?;
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{unc}")));
        }
        if let Some(local) = text.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(local));
        }
    }
    Ok(path)
}
pub fn canonical_future(path: &Path) -> Result<PathBuf, AppError> {
    let mut normalized = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    if normalized.exists() {
        return canonical(&normalized);
    }
    let name = normalized
        .file_name()
        .ok_or_else(|| invalid("Invalid path"))?;
    Ok(canonical_future(
        normalized
            .parent()
            .ok_or_else(|| invalid("Invalid parent"))?,
    )?
    .join(name))
}
pub fn within(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        Path::new(&path.to_string_lossy().to_lowercase())
            .starts_with(Path::new(&root.to_string_lossy().to_lowercase()))
    }
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}
pub fn is_reparse(path: &Path) -> Result<bool, AppError> {
    let meta = fs::symlink_metadata(path).map_err(|e| invalid(e.to_string()))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Ok(meta.file_attributes() & 0x400 != 0)
    }
    #[cfg(not(windows))]
    {
        Ok(meta.file_type().is_symlink())
    }
}
fn check_local(path: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{Win32::Storage::FileSystem::GetDriveTypeW, core::PCWSTR};
        let text = path.to_string_lossy();
        if text.starts_with(r"\\") {
            return Err(invalid("Network profiles are forbidden"));
        }
        let root: Vec<u16> = path
            .components()
            .take(2)
            .collect::<PathBuf>()
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let kind = unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) };
        if !matches!(kind, 2 | 3 | 6) {
            return Err(invalid("Profile must be on a local writable drive"));
        }
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}
