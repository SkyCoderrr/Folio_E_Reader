use crate::{AppState, contract::*, import::Library};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
pub async fn dialog_pick_folder(window: WebviewWindow) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .file()
            .set_parent(&window)
            .blocking_pick_folder()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(crate::storage::io_error)
            })
            .transpose()
    })
    .await
    .map_err(crate::storage::io_error)?
}
#[tauri::command]
pub async fn library_set_folder(
    app: tauri::AppHandle,
    path: serde_json::Value,
    move_files: bool,
) -> Result<LibrarySetFolderResult, AppError> {
    use tauri::{Emitter, Manager};
    let path = if path.is_null() {
        None
    } else {
        Some(
            path.as_str()
                .ok_or_else(|| {
                    crate::db::invalid("path", "Expected an absolute path string or null")
                })?
                .to_owned(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let default = state
            .profile
            .default_library(|| app.path().document_dir().map_err(crate::storage::io_error))?;
        state.library.with_idle(|| {
            state.library.prepare_folder_change()?;
            let mut settings = state.settings.snapshot()?;
            let before = settings.effective.library.clone();
            let result = crate::library_folder::change_with_commit(
                &state.profile,
                &state.library.db,
                &mut settings,
                path.as_deref(),
                move_files,
                &default,
                |path| {
                    let scope = app.asset_protocol_scope();
                    for file in crate::profile::library_files(path) {
                        scope.allow_file(file).map_err(crate::storage::io_error)?;
                    }
                    Ok(())
                },
                |candidate| {
                    let folder = candidate.effective.library.clone();
                    let library_dir = candidate.library_dir.clone();
                    let path = state.profile.settings.clone();
                    state.settings.update(move |live| {
                        live.effective.library = folder;
                        live.library_dir = library_dir;
                        live.write(&path)
                    })
                },
            )?;
            if before != settings.effective.library {
                let _ = app.emit(
                    event::SETTINGS_CHANGED,
                    SettingsChangedPayload {
                        settings: state.settings.snapshot()?.effective,
                        cause: SettingsChangedCause::LibraryFolder,
                    },
                );
            }
            Ok(result)
        })
    })
    .await
    .map_err(crate::storage::io_error)?
}

fn guarded<T>(
    command: &str,
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation))
        .unwrap_or_else(|_| Err(AppError::new(ErrorCode::Internal, "Command panicked")));
    if let Err(e) = &result {
        if matches!(
            e.code,
            ErrorCode::Internal | ErrorCode::DbError | ErrorCode::IoError
        ) {
            log::error!("{command}: {e}");
        } else {
            log::warn!("{command}: {e}");
        }
    }
    result
}
#[tauri::command]
pub async fn dialog_pick_books(window: WebviewWindow) -> Result<Vec<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        guarded("dialog_pick_books", || {
            window
                .dialog()
                .file()
                .set_parent(&window)
                .add_filter("Books", &["epub", "txt"])
                .blocking_pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|p| {
                    p.into_path()
                        .map(|p| p.to_string_lossy().into_owned())
                        .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))
                })
                .collect()
        })
    })
    .await
    .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))?
}
#[tauri::command]
pub async fn library_import(
    state: State<'_, AppState>,
    job_id: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let library = state.library.clone();
    tauri::async_runtime::spawn_blocking(move || {
        guarded("library_import", || library.enqueue(job_id, paths))
    })
    .await
    .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))?
}
pub(super) async fn worker<T: Send + 'static>(
    library: std::sync::Arc<Library>,
    name: &'static str,
    operation: impl FnOnce(&Library) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || guarded(name, || operation(&library)))
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))?
}
#[tauri::command]
pub async fn library_list(state: State<'_, AppState>) -> Result<Vec<BookRecord>, AppError> {
    worker(state.library.clone(), "library_list", |l| l.db.list()).await
}
#[tauri::command]
pub async fn book_get(state: State<'_, AppState>, book_id: String) -> Result<BookRecord, AppError> {
    worker(state.library.clone(), "book_get", move |l| {
        l.db.get(&book_id)
    })
    .await
}
#[tauri::command]
pub async fn library_remove(
    state: State<'_, AppState>,
    book_ids: Vec<String>,
) -> Result<LibraryRemoveResult, AppError> {
    worker(state.library.clone(), "library_remove", move |l| {
        l.remove(&book_ids)
    })
    .await
}
#[tauri::command]
pub async fn book_open(app: tauri::AppHandle, book_id: String) -> Result<BookOpenResult, AppError> {
    use tauri::Manager;
    let handle = app.clone();
    super::state_worker(app, move |state| {
        state
            .library
            .access
            .with_books(std::slice::from_ref(&book_id), || {
                let result = state.library.db.open_book(&book_id)?;
                handle
                    .asset_protocol_scope()
                    .allow_file(&result.book.file_path)
                    .map_err(crate::storage::io_error)?;
                Ok(result)
            })
    })
    .await
}
#[tauri::command]
pub async fn position_get(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Option<Locator>, AppError> {
    worker(state.library.clone(), "position_get", move |l| {
        l.db.position_get(&book_id)
    })
    .await
}
#[tauri::command]
pub async fn position_save(
    state: State<'_, AppState>,
    book_id: String,
    locator: serde_json::Value,
) -> Result<(), AppError> {
    worker(state.library.clone(), "position_save", move |l| {
        l.db.position_save(&book_id, locator)
    })
    .await
}
