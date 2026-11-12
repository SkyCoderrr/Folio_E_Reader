use crate::{contract::AppError, profile::is_reparse};
use std::path::{Path, PathBuf};
pub struct Candidate {
    pub path: PathBuf,
    pub error: Option<AppError>,
}
pub fn io(path: &Path, op: &str, error: impl std::fmt::Display) -> AppError {
    crate::contract::AppError::new(crate::contract::ErrorCode::IoError, error.to_string())
        .with_details(serde_json::json!({"path":path,"op":op,"osCode":null}))
}
pub fn format(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "epub" => Some("epub"),
        "txt" => Some("txt"),
        _ => None,
    }
}
pub fn enumerate(paths: &[String]) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    for path in paths {
        let path = PathBuf::from(path);
        match is_reparse(&path) {
            Ok(true) => continue,
            Err(e) => {
                candidates.push(Candidate {
                    error: Some(io(&path, "read", e)),
                    path,
                });
                continue;
            }
            Ok(false) => {}
        }
        if !path.is_dir() {
            candidates.push(Candidate { path, error: None });
            continue;
        }
        let walker = walkdir::WalkDir::new(&path)
            .follow_links(false)
            .sort_by(|a, b| {
                let a = a.file_name().to_string_lossy();
                let b = b.file_name().to_string_lossy();
                a.to_lowercase()
                    .cmp(&b.to_lowercase())
                    .then_with(|| a.cmp(&b))
            })
            .into_iter()
            .filter_entry(|e| !is_reparse(e.path()).unwrap_or(true));
        for entry in walker {
            match entry {
                Ok(entry) if entry.file_type().is_file() && format(entry.path()).is_some() => {
                    candidates.push(Candidate {
                        path: entry.into_path(),
                        error: None,
                    })
                }
                Ok(_) => {}
                Err(e) => {
                    let path = e.path().unwrap_or(&path).to_owned();
                    candidates.push(Candidate {
                        error: Some(io(&path, "read", e)),
                        path,
                    });
                }
            }
        }
    }
    candidates
}
