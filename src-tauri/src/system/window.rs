use crate::{
    contract::{AppError, ErrorCode, WindowState, event},
    storage::{atomic_write, io_error},
};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
#[derive(Default)]
pub struct Lifecycle {
    pub closing: AtomicBool,
    pub last: Mutex<Option<WindowState>>,
    geometry: Mutex<Option<serde_json::Value>>,
}
pub fn state(window: &WebviewWindow) -> Result<WindowState, AppError> {
    let map = |e| AppError::new(ErrorCode::Internal, format!("{e}"));
    Ok(WindowState {
        maximized: window.is_maximized().map_err(map)?,
        minimized: window.is_minimized().map_err(map)?,
        fullscreen: window.is_fullscreen().map_err(map)?,
        focused: window.is_focused().map_err(map)?,
        visible: window.is_visible().map_err(map)?,
        scale_factor: window.scale_factor().map_err(map)?,
    })
}
pub fn publish(window: &WebviewWindow) {
    if let Ok(current) = state(window) {
        capture_geometry(window, &current);
        let lifecycle = window.state::<Lifecycle>();
        if let Ok(mut last) = lifecycle.last.lock()
            && last.as_ref() != Some(&current)
        {
            *last = Some(current.clone());
            if let Err(e) = window.emit(event::WINDOW_STATE_CHANGED, current) {
                log::warn!("window state event: {e}");
            }
        }
    }
}
pub fn save(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let runtime = app.state::<crate::AppState>();
        if let Err(e) = save_window(&window, &runtime.profile.window_state) {
            log::warn!("window state save: {e}");
        }
    }
}
fn capture_geometry(window: &WebviewWindow, current: &WindowState) {
    if current.minimized || current.fullscreen {
        return;
    }
    // Read native state before taking our lock: dispatch can pump window events.
    let normal = if !current.maximized {
        match (
            window.inner_size(),
            window.outer_position(),
            window.current_monitor(),
        ) {
            (Ok(size), Ok(pos), Ok(monitor)) => Some(
                serde_json::json!({"width":size.width,"height":size.height,"x":pos.x,"y":pos.y,"monitor":monitor.map(|m|*m.position()),"maximized":false}),
            ),
            _ => None,
        }
    } else {
        None
    };
    let lifecycle = window.state::<Lifecycle>();
    if let Ok(mut geometry) = lifecycle.geometry.lock() {
        if let Some(normal) = normal {
            *geometry = Some(normal);
        }
        if let Some(value) = geometry.as_mut() {
            value["maximized"] = serde_json::json!(current.maximized);
        }
    }
}
fn save_window(window: &WebviewWindow, path: &std::path::Path) -> Result<(), AppError> {
    if let Ok(current) = state(window) {
        capture_geometry(window, &current);
    }
    let lifecycle = window.state::<Lifecycle>();
    let geometry = lifecycle.geometry.lock().map_err(io_error)?;
    if let Some(value) = geometry.as_ref() {
        atomic_write(path, value)?;
    }
    Ok(())
}
pub fn restore(window: &WebviewWindow, path: &std::path::Path) -> Result<(), AppError> {
    let value: serde_json::Value = match std::fs::read(path) {
        Ok(b) => match serde_json::from_slice(&b) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Ignored invalid window state: {e}");
                return Ok(());
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(io_error(e)),
    };
    *window
        .state::<Lifecycle>()
        .geometry
        .lock()
        .map_err(io_error)? = Some(value.clone());
    let monitors = window.available_monitors().map_err(io_error)?;
    let x = value["x"].as_i64().and_then(|v| i32::try_from(v).ok());
    let y = value["y"].as_i64().and_then(|v| i32::try_from(v).ok());
    let width = value["width"].as_u64().and_then(|v| u32::try_from(v).ok());
    let height = value["height"].as_u64().and_then(|v| u32::try_from(v).ok());
    if let (Some(x), Some(y), Some(w), Some(h)) = (x, y, width, height) {
        let visible = monitors.iter().any(|m| {
            let p = m.position();
            let s = m.size();
            x as i64 >= p.x as i64
                && y as i64 >= p.y as i64
                && (x as i64) < p.x as i64 + s.width as i64
                && (y as i64) < p.y as i64 + s.height as i64
        });
        if (480..=16384).contains(&w) && (400..=16384).contains(&h) {
            window
                .set_size(tauri::PhysicalSize::new(w, h))
                .map_err(io_error)?;
        }
        if visible {
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(io_error)?;
        } else {
            window.center().map_err(io_error)?;
        }
    }
    if value["maximized"].as_bool() == Some(true) {
        window.maximize().map_err(io_error)?;
    }
    Ok(())
}
fn arm_deadline(app: &AppHandle) -> bool {
    let lifecycle = app.state::<Lifecycle>();
    if lifecycle.closing.swap(true, Ordering::AcqRel) {
        return false;
    }
    app.state::<crate::AppState>().library.close();
    // A separate deadline thread guarantees cleanup never extends the budget.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(3000));
        std::process::exit(0);
    });
    true
}
pub fn request_close(app: &AppHandle) {
    if !arm_deadline(app) {
        return;
    }
    log::info!("Close requested; waiting for frontend save and app_quit");
    let _ = app.emit(event::APP_CLOSE_REQUESTED, ());
    let app = app.clone();
    std::thread::spawn(move || {
        save(&app);
        log::logger().flush();
    });
}
pub fn quit(app: &AppHandle) {
    log::info!("app_quit acknowledged; saving window and checkpointing library");
    arm_deadline(app);
    let app = app.clone();
    std::thread::spawn(move || {
        save(&app);
        app.state::<crate::AppState>().library.checkpoint();
        log::logger().flush();
        app.exit(0);
    });
}
pub fn show(app: &AppHandle) {
    show_from(app, "secondInstance");
}
pub fn toggle(app: &AppHandle, source: &str) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let start = std::time::Instant::now();
            match window.hide() {
                Ok(()) => {
                    log::info!(
                        "boss hidden source={source} elapsed_us={}",
                        start.elapsed().as_micros()
                    );
                    let _ = app.emit(event::BOSS_HIDDEN, serde_json::json!({"source":source}));
                    publish(&window);
                }
                Err(error) => log::warn!("boss hide: {error}"),
            }
        } else {
            show_from(app, source);
        }
    }
}
pub fn show_from(app: &AppHandle, source: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let hidden = window.is_visible().map(|v| !v).unwrap_or(false);
        if let Err(e) = window
            .show()
            .and_then(|_| window.unminimize())
            .and_then(|_| window.set_focus())
        {
            log::warn!("window focus ({source}): {e}");
            return;
        }
        if hidden {
            let _ = app.emit(event::BOSS_SHOWN, serde_json::json!({"source":source}));
            log::info!("boss shown source={source}");
        }
        publish(&window);
    }
}
#[cfg(windows)]
pub fn configure_webview(window: &WebviewWindow) -> Result<(), AppError> {
    window.set_zoom(1.0).map_err(io_error)?;
    if !cfg!(debug_assertions) {
        window
            .with_webview(|view| {
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                use windows::core::Interface;
                let result = (|| -> windows::core::Result<()> {
                    unsafe {
                        let settings = view.controller().CoreWebView2()?.Settings()?;
                        settings
                            .cast::<ICoreWebView2Settings3>()?
                            .SetAreBrowserAcceleratorKeysEnabled(false)?;
                        Ok(())
                    }
                })();
                if let Err(e) = result {
                    log::error!("Cannot disable browser accelerators: {e}");
                    std::process::exit(2);
                }
            })
            .map_err(io_error)?;
    }
    Ok(())
}
