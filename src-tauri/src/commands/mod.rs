use crate::{AppState, contract::*, system::window};
mod library;
mod reading;
pub use library::*;
pub use reading::*;
use tauri::{AppHandle, WebviewWindow};
fn op(error: tauri::Error) -> AppError {
    AppError::new(ErrorCode::WindowOpFailed, error.to_string())
        .with_details(serde_json::json!({"op":"window","osMessage":error.to_string()}))
}
#[tauri::command]
pub async fn app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    state_worker(app, runtime_info).await
}
fn runtime_info(state: &AppState) -> Result<AppInfo, AppError> {
    let library_dir = state.library.db.library_dir();
    Ok(AppInfo {
        app_version: env!("CARGO_PKG_VERSION").into(),
        contract_version: CONTRACT_VERSION.into(),
        profile_dir: state.profile.root.to_string_lossy().into_owned(),
        library_dir: library_dir.to_string_lossy().into_owned(),
        is_test_profile: state.profile.is_test,
        is_debug_build: cfg!(debug_assertions),
        title_bar_mode: state.applied_title_bar,
        library_offline: state.library.db.library_offline(),
    })
}

#[tauri::command]
pub fn app_quit(app: AppHandle) -> Result<(), AppError> {
    window::quit(&app);
    Ok(())
}
#[tauri::command]
pub fn window_get_state(window: WebviewWindow) -> Result<WindowState, AppError> {
    window::state(&window)
}
#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> Result<(), AppError> {
    window.minimize().map_err(op)?;
    window::publish(&window);
    Ok(())
}
#[tauri::command]
pub fn window_toggle_maximize(window: WebviewWindow) -> Result<(), AppError> {
    if !window.is_fullscreen().map_err(op)? {
        if window.is_maximized().map_err(op)? {
            window.unmaximize().map_err(op)?;
        } else {
            window.maximize().map_err(op)?;
        }
    }
    window::publish(&window);
    Ok(())
}
#[tauri::command]
pub fn window_start_drag(window: WebviewWindow) -> Result<(), AppError> {
    if window.is_fullscreen().map_err(op)? {
        return Ok(());
    }
    #[cfg(windows)]
    return crate::system::window_frame::start_drag(&window);
    #[cfg(not(windows))]
    window.start_dragging().map_err(op)
}
#[tauri::command]
pub fn window_start_resize(
    window: WebviewWindow,
    direction: ResizeDirection,
) -> Result<(), AppError> {
    use tauri_runtime::ResizeDirection as D;
    if window.is_fullscreen().map_err(op)? || window.is_maximized().map_err(op)? {
        return Ok(());
    }
    window
        .as_ref()
        .window()
        .start_resize_dragging(match direction {
            ResizeDirection::North => D::North,
            ResizeDirection::South => D::South,
            ResizeDirection::East => D::East,
            ResizeDirection::West => D::West,
            ResizeDirection::NorthEast => D::NorthEast,
            ResizeDirection::NorthWest => D::NorthWest,
            ResizeDirection::SouthEast => D::SouthEast,
            ResizeDirection::SouthWest => D::SouthWest,
        })
        .map_err(op)
}
#[tauri::command]
pub async fn window_set_fullscreen(
    window: WebviewWindow,
    fullscreen: bool,
) -> Result<(), AppError> {
    #[cfg(windows)]
    return crate::system::window_frame::set_fullscreen(window, fullscreen).await;
    #[cfg(not(windows))]
    {
        if window.is_fullscreen().map_err(op)? != fullscreen {
            crate::system::window_frame::fullscreen(&window, true);
            if let Err(e) = window.set_fullscreen(fullscreen) {
                crate::system::window_frame::fullscreen(
                    &window,
                    window.is_fullscreen().unwrap_or(false),
                );
                return Err(op(e));
            }
            crate::system::window_frame::fullscreen(&window, fullscreen);
        }
        window::publish(&window);
        Ok(())
    }
}
#[tauri::command]
pub async fn window_set_caption_rects(
    window: WebviewWindow,
    rects: Option<CaptionRects>,
) -> Result<(), AppError> {
    #[cfg(windows)]
    return crate::system::window_frame::set_caption_rects(window, rects).await;
    #[cfg(not(windows))]
    {
        let _ = (window, rects);
        Err(AppError::new(
            ErrorCode::WindowOpFailed,
            "Windows frame requires Windows",
        ))
    }
}
pub(super) async fn state_worker<T: Send + 'static>(
    app: AppHandle,
    operation: impl FnOnce(&AppState) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || operation(&app.state::<AppState>()))
        .await
        .map_err(crate::storage::io_error)?
}
#[tauri::command]
pub async fn kv_get(app: AppHandle, key: String) -> Result<JsonValue, AppError> {
    state_worker(app, move |state| state.kv.get(&key)).await
}
#[tauri::command]
pub async fn kv_set(app: AppHandle, key: String, value: JsonValue) -> Result<(), AppError> {
    state_worker(app, move |state| state.kv.set(&key, value)).await
}
#[tauri::command]
pub async fn settings_get(app: AppHandle) -> Result<Settings, AppError> {
    state_worker(app, |state| Ok(state.settings.snapshot()?.effective)).await
}
#[tauri::command]
pub async fn settings_patch(
    app: AppHandle,
    patch: serde_json::Value,
) -> Result<Settings, AppError> {
    state_worker(app, move |state| {
        let path = state.profile.settings.clone();
        let test = state.profile.is_test;
        state
            .settings
            .update(move |candidate| candidate.change(&path, patch, true, test))
    })
    .await
}
#[tauri::command]
pub async fn settings_set(
    app: AppHandle,
    settings: serde_json::Value,
) -> Result<Settings, AppError> {
    state_worker(app, move |state| {
        let path = state.profile.settings.clone();
        let test = state.profile.is_test;
        state
            .settings
            .update(move |candidate| candidate.change(&path, settings, false, test))
    })
    .await
}
#[tauri::command]
pub async fn fonts_list() -> Result<Vec<FontFamily>, AppError> {
    tauri::async_runtime::spawn_blocking(|| Ok(crate::fonts::list().clone()))
        .await
        .map_err(crate::storage::io_error)?
}
#[tauri::command]
pub async fn boss_get_status(app: AppHandle) -> Result<BossKeyStatus, AppError> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<crate::system::boss::Boss>().status())
        .await
        .map_err(crate::storage::io_error)?
}
async fn change_boss(
    app: AppHandle,
    enabled: Option<bool>,
    shortcut: Option<String>,
) -> Result<BossKeyStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        app.state::<crate::system::boss::Boss>()
            .change(&app, enabled, shortcut)
    })
    .await
    .map_err(crate::storage::io_error)?
}
#[tauri::command]
pub async fn boss_set_enabled(app: AppHandle, enabled: bool) -> Result<BossKeyStatus, AppError> {
    change_boss(app, Some(enabled), None).await
}
#[tauri::command]
pub async fn boss_set_shortcut(
    app: AppHandle,
    shortcut: String,
) -> Result<BossKeyStatus, AppError> {
    change_boss(app, None, Some(shortcut)).await
}

#[cfg(test)]
mod batch2_tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, mpsc};
    fn state() -> (tempfile::TempDir, AppState) {
        let temp = tempfile::tempdir().unwrap();
        let profile = crate::profile::Profile::resolve(
            Some(temp.path().join("profile").into_os_string()),
            || panic!(),
        )
        .unwrap();
        let settings = crate::settings::load(&profile, || panic!()).unwrap();
        let db = crate::db::Database::open(profile.clone(), settings.library_dir.clone());
        let kv = crate::kv::KvStore::open(profile.kv.clone()).unwrap();
        (
            temp,
            AppState {
                profile,
                settings: crate::storage::SnapshotStore::new(settings),
                kv,
                applied_title_bar: TitleBarMode::Custom,
                library: Arc::new(crate::import::Library::start(db, |_| {})),
            },
        )
    }
    #[test]
    fn app_info_reports_applied_mode_after_pending_setting_changes() {
        let (_temp, state) = state();
        state
            .settings
            .update(|s| {
                s.effective.window.title_bar = TitleBarMode::Native;
                Ok(())
            })
            .unwrap();
        assert_eq!(
            runtime_info(&state).unwrap().title_bar_mode,
            TitleBarMode::Custom
        );
        state.library.close();
    }
    #[test]
    fn app_info_tracks_offline_root_and_recovery_without_rewriting_settings() {
        let (temp, state) = state();
        let custom = temp.path().join("custom");
        std::fs::create_dir(&custom).unwrap();
        state.library.db.set_library_dir(custom.clone());
        state.library.db.require_existing_library(true);
        let folder = custom.to_string_lossy().into_owned();
        let path = state.profile.settings.clone();
        state
            .settings
            .update(move |settings| {
                settings.effective.library.folder = Some(folder);
                settings.library_dir = custom;
                settings.write(&path)
            })
            .unwrap();
        let before = std::fs::read(&state.profile.settings).unwrap();
        std::fs::remove_dir(state.library.db.library_dir()).unwrap();
        assert!(runtime_info(&state).unwrap().library_offline);
        assert!(
            state
                .settings
                .snapshot()
                .unwrap()
                .effective
                .library
                .folder
                .is_some()
        );
        std::fs::create_dir(state.library.db.library_dir()).unwrap();
        assert!(!runtime_info(&state).unwrap().library_offline);
        assert_eq!(std::fs::read(&state.profile.settings).unwrap(), before);
        state.library.close();
    }
    #[test]
    fn persistence_and_reads_finish_while_folder_file_gate_is_held() {
        let (temp, state) = state();
        let source = temp.path().join("book.txt");
        std::fs::write(&source, "book").unwrap();
        let (_, book) = crate::import::pipeline::item(
            &state.library.db,
            &mut crate::import::journal::Journal::load(&state.library.db).unwrap(),
            &source,
        )
        .unwrap();
        let id = book.unwrap().id;
        let guard = state.library.access.root.write().unwrap();
        let library = state.library.clone();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let result = tauri::async_runtime::block_on(super::library::worker(
                library,
                "position_save",
                move |l| {
                    l.db.position_save(&id, json!({"sectionIndex":0,"cfi":null,"charOffset":7,"globalCharOffset":7,"progress":0.5,"snippet":"saved"}))?;
                    assert_eq!(l.db.position_get(&id)?.unwrap().char_offset, 7);
                    assert_eq!(l.db.list()?.len(), 1);
                    assert_eq!(l.db.get(&id)?.id, id);
                    assert!(l.db.bookmarks_list(&id)?.is_empty());
                    l.db.chapter_mark_read(&id, "chapter")?;
                    assert!(!l.db.chapters_read_get(&id)?.chapter_keys.is_empty());
                    l.db.stats_session_save(ReadingSessionInput {
                        book_id: id,
                        started_at: 1794268800000,
                        ended_at: 1794269100000,
                        active_ms: 300000,
                        chars_read: 1500,
                        start_progress: 0.1,
                        end_progress: 0.2,
                    })?;
                    l.db.stats_query("2026-11-10", "2026-11-11")?;
                    Ok(())
                },
            ));
            tx.send(result).unwrap();
        });
        let result = rx.recv_timeout(std::time::Duration::from_millis(1200));
        drop(guard);
        result
            .expect("persistence waited behind folder file gate")
            .unwrap();
        state.library.close();
    }
}
