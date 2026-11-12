use crate::contract::*;
#[cfg(test)]
use crate::storage::io_error;
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

pub fn parse(chord: &str) -> Result<Shortcut, AppError> {
    let invalid = |reason: &str| {
        AppError::new(ErrorCode::ShortcutInvalid, reason)
            .with_details(serde_json::json!({"shortcut":chord,"reason":reason}))
    };
    let mut key = chord;
    let mut mods = Modifiers::empty();
    for (prefix, flag) in [
        ("Ctrl+", Modifiers::CONTROL),
        ("Alt+", Modifiers::ALT),
        ("Shift+", Modifiers::SHIFT),
    ] {
        if let Some(rest) = key.strip_prefix(prefix) {
            mods |= flag;
            key = rest;
        }
    }
    let function = key
        .strip_prefix('F')
        .and_then(|s| s.parse::<u8>().ok())
        .filter(|n| (1..=24).contains(n) && key == format!("F{n}"));
    let digit = key.len() == 1 && key.as_bytes()[0].is_ascii_digit();
    let letter = key.len() == 1 && key.as_bytes()[0].is_ascii_uppercase();
    let numpad = key
        .strip_prefix("Numpad")
        .is_some_and(|s| s.len() == 1 && s.as_bytes()[0].is_ascii_digit());
    let named = [
        "NumpadAdd",
        "NumpadSubtract",
        "NumpadMultiply",
        "NumpadDivide",
        "NumpadDecimal",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "Insert",
        "Delete",
        "Backspace",
        "Enter",
        "Tab",
        "Escape",
        "Space",
        "Backquote",
        "Minus",
        "Equal",
        "BracketLeft",
        "BracketRight",
        "Backslash",
        "Semicolon",
        "Quote",
        "Comma",
        "Period",
        "Slash",
        "Pause",
        "ScrollLock",
        "PrintScreen",
    ];
    // NumpadEnter aliases Enter in RegisterHotKey. Intl* and ContextMenu have no distinct mapping.
    if !(letter || digit || function.is_some() || numpad || named.contains(&key)) {
        return Err(invalid("Unsupported or ambiguous Windows boss key token"));
    }
    if mods.is_empty()
        && !["Pause", "ScrollLock"].contains(&key)
        && !function.is_some_and(|n| n >= 13)
    {
        return Err(invalid(
            "Boss key requires a modifier or Pause/ScrollLock/F13-F24",
        ));
    }
    let token = if letter {
        format!("Key{key}")
    } else if digit {
        format!("Digit{key}")
    } else {
        key.to_owned()
    };
    let code: Code = token.parse().map_err(|_| invalid("Unsupported code"))?;
    Ok(Shortcut::new(Some(mods), code))
}

pub trait Registrar {
    fn register(&mut self, chord: &str) -> Result<(), AppError>;
    fn unregister(&mut self, chord: &str) -> Result<(), AppError>;
    fn registered(&self, chord: &str) -> bool;
}
struct NativeRegistrar<'a>(&'a AppHandle);
fn registration_error(chord: &str, error: impl std::fmt::Display) -> AppError {
    let message = error.to_string();
    let occupied = message.contains("HotKey already registered:");
    AppError::new(
        if occupied {
            ErrorCode::ShortcutInUse
        } else {
            ErrorCode::ShortcutRegisterFailed
        },
        &message,
    )
    .with_details(if occupied {
        serde_json::json!({"shortcut":chord})
    } else {
        serde_json::json!({"shortcut":chord,"osMessage":message})
    })
}
impl Registrar for NativeRegistrar<'_> {
    fn register(&mut self, chord: &str) -> Result<(), AppError> {
        self.0
            .global_shortcut()
            .register(parse(chord)?)
            .map_err(|e| registration_error(chord, e))
    }
    fn unregister(&mut self, chord: &str) -> Result<(), AppError> {
        self.0
            .global_shortcut()
            .unregister(parse(chord)?)
            .map_err(|e| registration_error(chord, e))
    }
    fn registered(&self, chord: &str) -> bool {
        parse(chord).is_ok_and(|s| self.0.global_shortcut().is_registered(s))
    }
}

pub struct Boss {
    status: crate::storage::SnapshotStore<BossKeyStatus>,
    // Never take the setter/settings locks from the UI-thread hotkey callback.
    active: Arc<AtomicU32>,
}
impl Boss {
    pub fn new(settings: &BossKeySettings) -> Self {
        Self {
            status: crate::storage::SnapshotStore::new(BossKeyStatus {
                enabled: settings.enabled,
                shortcut: settings.shortcut.clone(),
                registered: false,
                error: None,
            }),
            active: Arc::new(AtomicU32::new(0)),
        }
    }
    pub fn status(&self) -> Result<BossKeyStatus, AppError> {
        self.status.snapshot()
    }
    pub fn accepts(
        &self,
        shortcut: &Shortcut,
        state: tauri_plugin_global_shortcut::ShortcutState,
    ) -> bool {
        state == tauri_plugin_global_shortcut::ShortcutState::Pressed
            && self.active.load(Ordering::Acquire) == shortcut.id()
    }
    #[cfg(test)]
    fn activate(&self, status: &BossKeyStatus) {
        activate(&self.active, status);
    }
    pub fn startup(&self, app: &AppHandle) {
        let app = app.clone();
        let active = self.active.clone();
        if let Err(error) = self.status.update(move |status| {
            register_startup(&app, status);
            activate(&active, status);
            Ok(())
        }) {
            log::error!("boss startup: {error}");
        }
    }
    pub fn change(
        &self,
        app: &AppHandle,
        enabled: Option<bool>,
        shortcut: Option<String>,
    ) -> Result<BossKeyStatus, AppError> {
        let app = app.clone();
        let active = self.active.clone();
        // Publish the actual registration state even if persistence/rollback fails.
        self.status
            .update(move |status| Ok(change_status(&app, &active, status, enabled, shortcut)))?
    }
}
fn activate(active: &AtomicU32, status: &BossKeyStatus) {
    active.store(
        if status.enabled && status.registered {
            parse(&status.shortcut).map(|s| s.id()).unwrap_or(0)
        } else {
            0
        },
        Ordering::Release,
    );
}
fn register_startup(app: &AppHandle, status: &mut BossKeyStatus) {
    if status.enabled {
        match NativeRegistrar(app).register(&status.shortcut) {
            Ok(()) => status.registered = true,
            Err(error) => {
                log::warn!("boss registration: {error}");
                status.error = Some(error.clone());
                let _ = app.emit(
                    event::BOSS_REGISTER_FAILED,
                    BossRegisterFailedPayload {
                        shortcut: status.shortcut.clone(),
                        error,
                    },
                );
            }
        }
    }
}
fn change_status(
    app: &AppHandle,
    active: &AtomicU32,
    status: &mut BossKeyStatus,
    enabled: Option<bool>,
    shortcut: Option<String>,
) -> Result<BossKeyStatus, AppError> {
    let state = app.state::<crate::AppState>();
    let target = BossKeySettings {
        enabled: enabled.unwrap_or(status.enabled),
        shortcut: shortcut.unwrap_or_else(|| status.shortcut.clone()),
    };
    let mut changed = None;
    let result = transition(status, target, &mut NativeRegistrar(app), |value| {
        let value = value.clone();
        let path = state.profile.settings.clone();
        changed = Some(state.settings.update(move |candidate| {
            candidate.effective.boss_key = value;
            candidate.write(&path)?;
            Ok(candidate.effective.clone())
        })?);
        Ok(())
    });
    activate(active, status);
    if let Err(error) = &result {
        if error.code == ErrorCode::Internal {
            let _ = app.emit(
                event::BOSS_REGISTER_FAILED,
                BossRegisterFailedPayload {
                    shortcut: status.shortcut.clone(),
                    error: error.clone(),
                },
            );
        }
    } else if let Some(settings) = changed {
        let _ = app.emit(
            event::SETTINGS_CHANGED,
            SettingsChangedPayload {
                settings,
                cause: SettingsChangedCause::BossKey,
            },
        );
    }
    result
}

pub fn transition(
    status: &mut BossKeyStatus,
    target: BossKeySettings,
    registrar: &mut impl Registrar,
    persist: impl FnOnce(&BossKeySettings) -> Result<(), AppError>,
) -> Result<BossKeyStatus, AppError> {
    parse(&target.shortcut)?;
    let old = status.clone();
    if old.enabled == target.enabled
        && old.shortcut == target.shortcut
        && (!target.enabled || old.registered)
    {
        return Ok(old);
    }
    let old_registered = registrar.registered(&old.shortcut);
    let new_registered = registrar.registered(&target.shortcut);
    let attempt = (|| {
        if target.enabled && !new_registered {
            registrar.register(&target.shortcut)?;
        }
        if old_registered && (!target.enabled || old.shortcut != target.shortcut) {
            registrar.unregister(&old.shortcut)?;
        }
        if old.enabled != target.enabled || old.shortcut != target.shortcut {
            persist(&target)?;
        }
        Ok(())
    })();
    if let Err(error) = attempt {
        let mut rollback_failed = false;
        // Restore the previous registration before dropping the new safety chord.
        for (chord, wanted) in [
            (&old.shortcut, old_registered),
            (&target.shortcut, new_registered),
        ] {
            if wanted != registrar.registered(chord) {
                let result = if wanted {
                    registrar.register(chord)
                } else {
                    registrar.unregister(chord)
                };
                rollback_failed |= result.is_err();
            }
        }
        status.registered = registrar.registered(&old.shortcut);
        if rollback_failed {
            let error = AppError::new(
                ErrorCode::Internal,
                "Boss-key rollback failed; query boss_get_status for actual state",
            );
            status.error = if status.enabled && !status.registered {
                Some(error.clone())
            } else {
                None
            };
            return Err(error);
        }
        *status = old;
        return Err(error);
    }
    *status = BossKeyStatus {
        enabled: target.enabled,
        shortcut: target.shortcut,
        registered: target.enabled,
        error: None,
    };
    Ok(status.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashSet, VecDeque};
    #[derive(Default)]
    struct Fake {
        owned: HashSet<String>,
        fail: VecDeque<String>,
        calls: Vec<String>,
    }
    impl Fake {
        fn op(&mut self, op: &str, chord: &str) -> Result<(), AppError> {
            let call = format!("{op}:{chord}");
            self.calls.push(call.clone());
            if self.fail.front() == Some(&call) {
                self.fail.pop_front();
                return Err(AppError::new(ErrorCode::ShortcutRegisterFailed, "injected"));
            }
            Ok(())
        }
    }
    impl Registrar for Fake {
        fn register(&mut self, chord: &str) -> Result<(), AppError> {
            self.op("register", chord)?;
            assert!(self.owned.insert(chord.into()));
            Ok(())
        }
        fn unregister(&mut self, chord: &str) -> Result<(), AppError> {
            self.op("unregister", chord)?;
            assert!(self.owned.remove(chord));
            Ok(())
        }
        fn registered(&self, chord: &str) -> bool {
            self.owned.contains(chord)
        }
    }
    fn fixture() -> (BossKeyStatus, Fake) {
        (
            BossKeyStatus {
                enabled: true,
                shortcut: "Ctrl+Alt+B".into(),
                registered: true,
                error: None,
            },
            Fake {
                owned: HashSet::from(["Ctrl+Alt+B".into()]),
                ..Default::default()
            },
        )
    }
    fn target(enabled: bool, shortcut: &str) -> BossKeySettings {
        BossKeySettings {
            enabled,
            shortcut: shortcut.into(),
        }
    }
    #[test]
    fn chord_grammar_and_boss_rule() {
        for chord in [
            "Ctrl+Alt+B",
            "Shift+1",
            "Alt+F1",
            "Ctrl+Alt+Shift+ArrowUp",
            "Pause",
            "ScrollLock",
            "F13",
            "F24",
        ] {
            assert!(parse(chord).is_ok(), "{chord}");
        }
        for chord in [
            "",
            "B",
            "Space",
            "F1",
            "F12",
            "F25",
            "F01",
            "ctrl+B",
            "Alt+Ctrl+B",
            "Ctrl+Ctrl+B",
            "Ctrl+KeyB",
            "Ctrl+Digit1",
            "Meta+B",
            "Ctrl+Alt+",
            "Ctrl+b",
            " Ctrl+B",
        ] {
            assert!(parse(chord).is_err(), "{chord}");
        }
    }
    #[test]
    fn windows_tokens_are_distinct_and_supported() {
        assert_eq!(parse("Ctrl+B").unwrap().key, Code::KeyB);
        assert_eq!(parse("Alt+1").unwrap().key, Code::Digit1);
        for token in [
            "Numpad0",
            "Numpad9",
            "NumpadAdd",
            "NumpadDecimal",
            "Enter",
            "Backslash",
            "PrintScreen",
            "Pause",
        ] {
            assert!(parse(&format!("Ctrl+{token}")).is_ok());
        }
        for token in [
            "NumpadEnter",
            "IntlBackslash",
            "IntlRo",
            "IntlYen",
            "ContextMenu",
            "CapsLock",
            "NumpadEqual",
        ] {
            assert_eq!(
                parse(&format!("Ctrl+{token}")).unwrap_err().code,
                ErrorCode::ShortcutInvalid
            );
        }
    }
    #[test]
    fn rebind_registers_new_before_removing_old_and_persisting() {
        let (mut status, mut registrar) = fixture();
        let result = transition(
            &mut status,
            target(true, "Ctrl+Alt+R"),
            &mut registrar,
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(
            registrar.calls,
            ["register:Ctrl+Alt+R", "unregister:Ctrl+Alt+B"]
        );
        assert_eq!(registrar.owned, HashSet::from(["Ctrl+Alt+R".into()]));
        assert!(result.registered);
    }
    #[test]
    fn occupied_rebind_never_persists_and_keeps_old() {
        let (mut status, mut registrar) = fixture();
        let before = status.clone();
        registrar.fail.push_back("register:Ctrl+Alt+R".into());
        transition(
            &mut status,
            target(true, "Ctrl+Alt+R"),
            &mut registrar,
            |_| panic!("persist on registration failure"),
        )
        .unwrap_err();
        assert_eq!(status, before);
        assert!(registrar.registered("Ctrl+Alt+B"));
    }
    #[test]
    fn persistence_failure_restores_old_registration() {
        let (mut status, mut registrar) = fixture();
        let before = status.clone();
        let error = transition(
            &mut status,
            target(true, "Ctrl+Alt+R"),
            &mut registrar,
            |_| Err(io_error("disk full")),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::IoError);
        assert_eq!(status, before);
        assert_eq!(registrar.owned, HashSet::from(["Ctrl+Alt+B".into()]));
    }
    #[test]
    fn unregister_failure_removes_new_registration() {
        let (mut status, mut registrar) = fixture();
        let before = status.clone();
        registrar.fail.push_back("unregister:Ctrl+Alt+B".into());
        transition(
            &mut status,
            target(true, "Ctrl+Alt+R"),
            &mut registrar,
            |_| panic!(),
        )
        .unwrap_err();
        assert_eq!(status, before);
        assert_eq!(registrar.owned, HashSet::from(["Ctrl+Alt+B".into()]));
    }
    #[test]
    fn failed_rollback_reports_actual_registration() {
        let (mut status, mut registrar) = fixture();
        registrar.fail.push_back("register:Ctrl+Alt+B".into());
        let error = transition(
            &mut status,
            target(true, "Ctrl+Alt+R"),
            &mut registrar,
            |_| Err(io_error("disk full")),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
        assert!(!status.registered);
        assert_eq!(status.error.unwrap().code, ErrorCode::Internal);
    }
    #[test]
    fn enable_and_disable_io_failures_roll_back() {
        let (mut status, mut registrar) = fixture();
        let before = status.clone();
        transition(
            &mut status,
            target(false, "Ctrl+Alt+B"),
            &mut registrar,
            |_| Err(io_error("disk full")),
        )
        .unwrap_err();
        assert_eq!(status, before);
        assert!(registrar.registered("Ctrl+Alt+B"));
        transition(
            &mut status,
            target(false, "Ctrl+Alt+B"),
            &mut registrar,
            |_| Ok(()),
        )
        .unwrap();
        let before = status.clone();
        transition(
            &mut status,
            target(true, "Ctrl+Alt+B"),
            &mut registrar,
            |_| Err(io_error("disk full")),
        )
        .unwrap_err();
        assert_eq!(status, before);
        assert!(!registrar.registered("Ctrl+Alt+B"));
    }
    #[test]
    fn disabled_rebind_validates_and_persists_without_os_calls() {
        let (mut status, mut registrar) = fixture();
        transition(
            &mut status,
            target(false, "Ctrl+Alt+B"),
            &mut registrar,
            |_| Ok(()),
        )
        .unwrap();
        registrar.calls.clear();
        transition(
            &mut status,
            target(false, "Ctrl+Alt+R"),
            &mut registrar,
            |_| Ok(()),
        )
        .unwrap();
        assert!(registrar.calls.is_empty());
        transition(
            &mut status,
            target(false, "B"),
            &mut registrar,
            |_| panic!(),
        )
        .unwrap_err();
        assert_eq!(status.shortcut, "Ctrl+Alt+R");
    }
    #[test]
    fn startup_failure_can_retry_without_rewriting_settings() {
        let (mut status, _) = fixture();
        let mut registrar = Fake::default();
        status.registered = false;
        status.error = Some(AppError::new(ErrorCode::ShortcutInUse, "occupied"));
        transition(
            &mut status,
            target(true, "Ctrl+Alt+B"),
            &mut registrar,
            |_| panic!("unchanged config"),
        )
        .unwrap();
        assert!(status.registered);
        assert!(status.error.is_none());
    }
    #[test]
    fn identical_active_shortcut_is_noop() {
        let (mut status, mut registrar) = fixture();
        transition(
            &mut status,
            target(true, "Ctrl+Alt+B"),
            &mut registrar,
            |_| panic!(),
        )
        .unwrap();
        assert!(registrar.calls.is_empty());
    }
    #[test]
    fn only_press_of_the_active_registered_chord_toggles() {
        use tauri_plugin_global_shortcut::ShortcutState::{Pressed, Released};
        let (status, _registrar) = fixture();
        let boss = Boss::new(&target(true, "Ctrl+Alt+B"));
        let chord = parse("Ctrl+Alt+B").unwrap();
        assert!(!boss.accepts(&chord, Pressed));
        boss.activate(&status);
        assert!(boss.accepts(&chord, Pressed));
        assert!(!boss.accepts(&chord, Released));
        assert!(!boss.accepts(&parse("Ctrl+Alt+R").unwrap(), Pressed));
    }
    #[test]
    fn status_and_hotkey_callback_do_not_wait_for_a_pending_settings_write() {
        use tauri_plugin_global_shortcut::ShortcutState::Pressed;
        let (status, _) = fixture();
        let boss = Arc::new(Boss::new(&target(true, "Ctrl+Alt+B")));
        boss.activate(&status);
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let changing = boss.clone();
        let writer = std::thread::spawn(move || {
            changing
                .status
                .update(move |_| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap()
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let reading = boss.clone();
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            assert!(reading.accepts(&parse("Ctrl+Alt+B").unwrap(), Pressed));
            read_tx.send(reading.status()).unwrap();
        });
        let result = read_rx.recv_timeout(std::time::Duration::from_millis(1200));
        release_tx.send(()).unwrap();
        writer.join().unwrap();
        reader.join().unwrap();
        assert!(
            result
                .expect("boss status waited for settings persistence")
                .unwrap()
                .enabled
        );
    }
}
