use crate::{contract::event, system::window};
use tauri::{
    AppHandle, Emitter,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show/Hide Folio", true, None::<&str>)?;
    let library = MenuItem::with_id(app, "library", "Library", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Folio", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &library, &settings, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../icons/32x32.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().unwrap_or(icon))
        .tooltip("Folio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                window::toggle(tray.app_handle(), "tray");
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => window::toggle(app, "tray"),
            "library" | "settings" => {
                window::show_from(app, "tray");
                let _ = app.emit(
                    if event.id.as_ref() == "library" {
                        event::TRAY_OPEN_LIBRARY
                    } else {
                        event::TRAY_OPEN_SETTINGS
                    },
                    (),
                );
            }
            "quit" => window::request_close(app),
            _ => (),
        })
        .build(app)?;
    log::info!("Tray installed (main, Folio)");
    Ok(())
}
