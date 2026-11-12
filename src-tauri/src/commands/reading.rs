use super::library::worker;
use crate::{AppState, contract::*};
use tauri::State;
#[tauri::command]
pub async fn chapters_read_get(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<ChaptersReadResult, AppError> {
    worker(state.library.clone(), "chapters_read_get", move |l| {
        l.db.chapters_read_get(&book_id)
    })
    .await
}
#[tauri::command]
pub async fn chapter_mark_read(
    state: State<'_, AppState>,
    book_id: String,
    chapter_key: String,
) -> Result<ChaptersReadResult, AppError> {
    worker(state.library.clone(), "chapter_mark_read", move |l| {
        l.db.chapter_mark_read(&book_id, &chapter_key)
    })
    .await
}
#[tauri::command]
pub async fn txt_prepare(app: tauri::AppHandle, book_id: String) -> Result<TxtManifest, AppError> {
    use tauri::Manager;
    let handle = app.clone();
    super::state_worker(app, move |state| {
        let settings = state.settings.snapshot()?.effective.txt;
        state
            .library
            .access
            .with_books(std::slice::from_ref(&book_id), || {
                let manifest = state.library.db.txt_prepare(&book_id, &settings)?;
                for section in &manifest.sections {
                    state
                        .library
                        .db
                        .managed_path(std::path::Path::new(&section.path))?;
                    handle
                        .asset_protocol_scope()
                        .allow_file(&section.path)
                        .map_err(crate::storage::io_error)?;
                }
                Ok(manifest)
            })
    })
    .await
}

#[tauri::command]
pub async fn txt_preview_split(
    state: State<'_, AppState>,
    book_id: String,
    chapter_regex: String,
    heading_max_chars: u32,
) -> Result<TxtPreviewSplitResult, AppError> {
    worker(state.library.clone(), "txt_preview_split", move |l| {
        l.access.with_books(std::slice::from_ref(&book_id), || {
            l.db.txt_preview_split(&book_id, &chapter_regex, heading_max_chars)
        })
    })
    .await
}
#[tauri::command]
pub async fn txt_prefs_set(
    state: State<'_, AppState>,
    book_id: String,
    patch: serde_json::Value,
) -> Result<TxtBookPrefs, AppError> {
    worker(state.library.clone(), "txt_prefs_set", move |l| {
        l.access.with_books(std::slice::from_ref(&book_id), || {
            l.db.txt_prefs_set(&book_id, patch)
        })
    })
    .await
}
#[tauri::command]
pub async fn bookmarks_list(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<Bookmark>, AppError> {
    worker(state.library.clone(), "bookmarks_list", move |l| {
        l.db.bookmarks_list(&book_id)
    })
    .await
}
fn nullable(value: serde_json::Value, field: &str) -> Result<Option<String>, AppError> {
    if value.is_null() {
        Ok(None)
    } else {
        value
            .as_str()
            .map(|v| Some(v.into()))
            .ok_or_else(|| crate::db::invalid(field, "Expected string or null"))
    }
}
#[tauri::command]
pub async fn bookmark_add(
    state: State<'_, AppState>,
    book_id: String,
    locator: serde_json::Value,
    chapter_title: serde_json::Value,
    snippet: serde_json::Value,
) -> Result<Bookmark, AppError> {
    let title = nullable(chapter_title, "chapterTitle")?;
    let snippet = nullable(snippet, "snippet")?;
    worker(state.library.clone(), "bookmark_add", move |l| {
        l.db.bookmark_add(&book_id, locator, title, snippet)
    })
    .await
}
#[tauri::command]
pub async fn bookmark_remove(
    state: State<'_, AppState>,
    bookmark_id: String,
) -> Result<(), AppError> {
    worker(state.library.clone(), "bookmark_remove", move |l| {
        l.db.bookmark_remove(&bookmark_id)
    })
    .await
}

#[tauri::command]
pub async fn stats_session_save(
    state: State<'_, AppState>,
    session: serde_json::Value,
) -> Result<(), AppError> {
    let session: ReadingSessionInput = serde_json::from_value(session)
        .map_err(|_| crate::db::invalid("session", "Invalid session shape"))?;
    worker(state.library.clone(), "stats_session_save", move |l| {
        l.db.stats_session_save(session)
    })
    .await
}
#[tauri::command]
pub async fn stats_query(
    state: State<'_, AppState>,
    from_day: String,
    to_day: String,
) -> Result<StatsQueryResult, AppError> {
    worker(state.library.clone(), "stats_query", move |l| {
        l.db.stats_query(&from_day, &to_day)
    })
    .await
}
#[tauri::command]
pub async fn book_set_total_chars(
    state: State<'_, AppState>,
    book_id: String,
    total_chars: u64,
) -> Result<(), AppError> {
    worker(state.library.clone(), "book_set_total_chars", move |l| {
        l.db.book_set_total_chars(&book_id, total_chars)
    })
    .await
}

#[tauri::command]
pub async fn book_set_section_chars(
    state: State<'_, AppState>,
    book_id: String,
    metrics: EpubSectionChars,
) -> Result<(), AppError> {
    worker(state.library.clone(), "book_set_section_chars", move |l| {
        l.access.with_books(std::slice::from_ref(&book_id), || {
            l.db.book_set_section_chars(&book_id, metrics)
        })
    })
    .await
}
