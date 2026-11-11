#[rustfmt::skip]
pub mod contract;
mod commands;
pub mod db;
pub mod fonts;
pub mod import;
pub mod kv;
pub mod library_folder;
pub mod profile;
pub mod settings;
pub mod storage;
mod system;
pub mod txt;
use contract::TitleBarMode;
use std::sync::Arc;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
pub struct AppState {
    pub profile: profile::Profile,
    pub settings: std::sync::Mutex<settings::LoadedSettings>,
    pub applied_title_bar: TitleBarMode,
    pub kv: kv::KvStore,
    pub library: Arc<import::Library>,
}
fn startup_error(error: impl std::fmt::Display) -> ! {
    eprintln!("Folio startup: {error}");
    #[cfg(windows)]
    unsafe {
        use windows::{
            Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW},
            core::PCWSTR,
        };
        let text: Vec<u16> = format!("Folio could not start:\n{error}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let title: Vec<u16> = "Folio".encode_utf16().chain(Some(0)).collect();
        MessageBoxW(
            None,
            PCWSTR(text.as_ptr()),
            PCWSTR(title.as_ptr()),
            MB_OK | MB_ICONERROR,
        );
    }
    std::process::exit(2)
}
pub fn run() {
    let started = std::time::Instant::now();
    let profile = profile::Profile::resolve(std::env::var_os("E_READER_PROFILE_DIR"), || {
        std::env::var_os("APPDATA")
            .map(|p| std::path::PathBuf::from(p).join("com.dany.ereader"))
            .ok_or_else(|| storage::io_error("APPDATA is absent"))
    })
    .unwrap_or_else(|e| startup_error(e));
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if app
                        .try_state::<system::boss::Boss>()
                        .is_some_and(|boss| boss.accepts(shortcut, event.state))
                    {
                        system::window::toggle(app, "bossKey");
                    }
                })
                .build(),
        )
        .manage(system::window::Lifecycle::default())
        .manage(system::window_frame::FrameGate::default())
        .setup(move |app| {
            let initialized = (|| -> Result<(), Box<dyn std::error::Error>> {
                app.handle().plugin(
                    tauri_plugin_log::Builder::new()
                        .targets([tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Folder {
                                path: profile.logs.clone(),
                                file_name: Some("e_reader".into()),
                            },
                        )])
                        .max_file_size(1_000_000)
                        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(4))
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
                log::info!(
                    "profile: {} (test: {})",
                    profile.root.display(),
                    profile.is_test
                );
                let pending = Arc::new(system::startup::ShowQueue::default());
                let show_pending = pending.clone();
                let handle = app.handle().clone();
                let instance = system::instance::Instance::acquire(&profile.key(), move || {
                    if show_pending.request() {
                        system::window::show(&handle);
                    }
                })?;
                let Some(instance) = instance else {
                    app.handle().exit(0);
                    return Ok(());
                };
                app.manage(instance);
                log::info!("Profile instance acquired");
                let settings = settings::load(&profile, || {
                    app.path().document_dir().map_err(storage::io_error)
                })?;
                log::info!("Settings loaded");
                app.manage(system::boss::Boss::new(&settings.effective.boss_key));
                let scope = app.asset_protocol_scope();
                if profile.validate_library(&settings.library_dir).is_ok() {
                    for file in profile::library_files(&settings.library_dir) {
                        if let Err(e) = scope.allow_file(&file) {
                            log::warn!("Library asset skipped: {e}");
                        }
                    }
                }
                for path in [&profile.cache, &profile.covers] {
                    if !profile::within(&profile::canonical_future(path)?, &profile.root) {
                        return Err(Box::new(storage::io_error("Asset root escapes profile")));
                    }
                    for file in profile::library_files(path) {
                        if let Err(e) = scope.allow_file(file) {
                            log::warn!("Generated asset skipped: {e}");
                        }
                    }
                }
                log::info!("Asset scope configured");
                let native = settings.effective.window.title_bar == TitleBarMode::Native;
                let kv = kv::KvStore::open(profile.kv.clone())?;
                let database = db::Database::open(profile.clone(), settings.library_dir.clone());
                database.require_existing_library(settings.effective.library.folder.is_some());
                std::thread::spawn(|| {
                    fonts::list();
                });
                let emitter = app.handle().clone();
                let library = Arc::new(import::Library::start(database, move |event| {
                    let result = match event {
                        import::ImportEvent::Item(payload) => {
                            if let Some(path) = payload
                                .book
                                .as_ref()
                                .and_then(|book| book.cover_path.as_ref())
                            {
                                // New covers did not exist during startup's safe-file scan.
                                if profile::ensure_no_reparse(std::path::Path::new(path)).is_ok() {
                                    if let Err(e) = emitter.asset_protocol_scope().allow_file(path)
                                    {
                                        log::warn!("Cover asset skipped: {e}");
                                    }
                                }
                            }
                            emitter.emit(contract::event::IMPORT_ITEM, payload)
                        }
                        import::ImportEvent::Done(payload) => {
                            emitter.emit(contract::event::IMPORT_DONE, payload)
                        }
                    };
                    if let Err(e) = result {
                        log::warn!("import event: {e}");
                    }
                }));
                app.manage(AppState {
                    profile: profile.clone(),
                    applied_title_bar: settings.effective.window.title_bar,
                    settings: std::sync::Mutex::new(settings),
                    kv,
                    library,
                });
                let handle = app.handle().clone();
                let profile = profile.clone();
                // Keep the main event loop pumping during asynchronous WebView2 creation.
                std::thread::spawn(move || {
                    let window_setup = (|| -> Result<(), Box<dyn std::error::Error>> {
                        log::info!(
                            "startup marker: window build begin {}ms",
                            started.elapsed().as_millis()
                        );
                        let window = WebviewWindowBuilder::new(
                            &handle,
                            "main",
                            WebviewUrl::App("index.html".into()),
                        )
                        .title("Folio")
                        .inner_size(1280.0, 800.0)
                        .min_inner_size(480.0, 400.0)
                        .decorations(native)
                        .shadow(true)
                        .resizable(true)
                        .background_color(tauri::window::Color(17, 18, 20, 255))
                        .data_directory(profile.webview.clone())
                        .zoom_hotkeys_enabled(false)
                        .visible(false)
                        .on_navigation(|url| {
                            log::info!("startup navigation: {url}");
                            true
                        })
                        .on_page_load(|window, payload| {
                            log::info!("startup page load: {:?}", payload.event());
                            system::window_frame::page_load(&window, payload.event());
                            log::info!("startup page load returned");
                        })
                        .build()?;
                        log::info!("Main window created");
                        log::info!(
                            "startup marker: WebView2 ready {}ms",
                            started.elapsed().as_millis()
                        );
                        system::window::configure_webview(&window)?;
                        #[cfg(windows)]
                        system::window_frame::install(&window)?;
                        log::info!("WebView configured");
                        system::window::restore(&window, &profile.window_state)?;
                        let event_window = window.clone();
                        window.on_window_event(move |event| match event {
                            tauri::WindowEvent::CloseRequested { api, .. } => {
                                api.prevent_close();
                                system::window::request_close(event_window.app_handle());
                            }
                            tauri::WindowEvent::Destroyed => {}
                            _ => system::window::publish(&event_window),
                        });
                        log::info!("Window state restored");
                        handle.state::<system::boss::Boss>().startup(&handle);
                        log::info!(
                            "startup marker: boss ready {}ms",
                            started.elapsed().as_millis()
                        );
                        system::tray::install(&handle)?;
                        window.show()?;
                        log::info!("Main window shown");
                        log::info!("startup marker: shown {}ms", started.elapsed().as_millis());
                        if pending.mark_ready() {
                            system::window::show(&handle);
                        }
                        system::window::publish(&window);
                        Ok(())
                    })();
                    if let Err(error) = window_setup {
                        log::error!("window startup: {error}");
                        startup_error(error);
                    }
                });
                Ok(())
            })();
            if let Err(error) = initialized {
                log::error!("startup: {error}");
                startup_error(error);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_quit,
            commands::window_get_state,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_start_drag,
            commands::window_start_resize,
            commands::window_set_fullscreen,
            commands::window_set_caption_rects,
            commands::kv_get,
            commands::kv_set,
            commands::settings_get,
            commands::settings_patch,
            commands::settings_set,
            commands::fonts_list,
            commands::boss_get_status,
            commands::boss_set_enabled,
            commands::boss_set_shortcut,
            commands::dialog_pick_folder,
            commands::library_set_folder,
            commands::dialog_pick_books,
            commands::library_import,
            commands::library_list,
            commands::book_get,
            commands::library_remove,
            commands::book_open,
            commands::position_get,
            commands::position_save,
            commands::txt_prepare,
            commands::txt_preview_split,
            commands::txt_prefs_set,
            commands::chapters_read_get,
            commands::chapter_mark_read,
            commands::bookmarks_list,
            commands::bookmark_add,
            commands::stats_session_save,
            commands::stats_query,
            commands::book_set_total_chars,
            commands::bookmark_remove
        ])
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|_, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                log::info!("startup marker: event loop ready");
            }
        }),
        Err(error) => startup_error(error),
    }
}
