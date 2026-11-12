use crate::{
    contract::{AppError, Settings},
    profile::Profile,
    storage::{atomic_write, io_error, quarantine},
};
use serde_json::{Map, Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub mod migrations;
impl Default for Settings {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../../contract/settings.defaults.json"))
            .expect("contract defaults")
    }
}
#[derive(Clone)]
pub struct LoadedSettings {
    pub effective: Settings,
    pub raw: Value,
    pub library_dir: PathBuf,
}
mod repair;
use repair::{matches, repair, schema};
pub fn load(
    profile: &Profile,
    documents: impl FnOnce() -> Result<PathBuf, AppError>,
) -> Result<LoadedSettings, AppError> {
    let mut defaults = serde_json::to_value(Settings::default()).map_err(io_error)?;
    if profile.is_test {
        defaults["bossKey"]["enabled"] = json!(false);
    }
    let raw = match fs::read(&profile.settings) {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(v) if v.is_object() => v,
            _ => {
                log::warn!("Unparseable settings moved aside");
                quarantine(&profile.settings)?;
                json!({})
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(io_error(e)),
    };
    let version = raw.get("version").and_then(Value::as_u64).unwrap_or(1);
    let migration = version != 1;
    if migration {
        migrations::backup(&profile.settings, version)?;
    }
    let root = schema();
    let mut fixed = repair(&raw, &root, &defaults, &root, "");
    if crate::system::boss::parse(fixed["bossKey"]["shortcut"].as_str().unwrap_or("")).is_err() {
        fixed["bossKey"]["shortcut"] = json!("Ctrl+Alt+B");
    }
    fixed["version"] = json!(1);
    let requested = fixed["library"]["folder"]
        .as_str()
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| profile.default_library(documents))?;
    let library_dir = profile.validate_library(&requested).unwrap_or_else(|e| {
        log::warn!("Library folder unavailable: {e}");
        requested
    });
    if !fancy_regex::Regex::new(&format!(
        "(?m){}",
        fixed["txt"]["chapterRegex"].as_str().unwrap_or("")
    ))
    .is_ok()
    {
        log::warn!("settings repair txt.chapterRegex");
        fixed["txt"]["chapterRegex"] = defaults["txt"]["chapterRegex"].clone();
    }
    let mut seen = std::collections::HashSet::new();
    fixed["presets"] = Value::Array(
        raw.get("presets")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|v| {
                matches(v, &root["properties"]["presets"]["items"], &root)
                    && seen.insert(v["id"].as_str().unwrap_or("").to_owned())
            })
            .cloned()
            .collect(),
    );
    let active = fixed["activePresetId"].as_str().unwrap_or("");
    if ![
        "builtin.dark",
        "builtin.sepia",
        "builtin.light",
        "builtin.night",
    ]
    .contains(&active)
        && !seen.contains(active)
    {
        log::warn!("settings repair activePresetId");
        fixed["activePresetId"] = defaults["activePresetId"].clone();
    }
    let mut bindings = Map::new();
    if let Some(input) = raw.get("keybindings").and_then(Value::as_object) {
        for (action, chords) in input {
            if !matches(&json!(action), &root["$defs"]["ActionId"], &root) {
                continue;
            }
            if let Some(chords) = chords.as_array() {
                let mut unique = Vec::new();
                for chord in chords {
                    if matches(chord, &root["$defs"]["Chord"], &root)
                        && !unique.contains(chord)
                        && unique.len() < 3
                    {
                        unique.push(chord.clone());
                    }
                }
                bindings.insert(action.clone(), json!(unique));
            }
        }
    }
    fixed["keybindings"] = Value::Object(bindings);
    if fixed != raw && !raw.as_object().is_some_and(Map::is_empty) {
        log::warn!("Settings repaired in memory; persisted with next change");
    }
    let effective = serde_json::from_value(fixed.clone()).map_err(io_error)?;
    let loaded = LoadedSettings {
        effective,
        raw,
        library_dir,
    };
    if migration {
        loaded.write(&profile.settings)?;
    }
    Ok(loaded)
}
impl LoadedSettings {
    pub fn write(&self, path: &Path) -> Result<(), AppError> {
        fn overlay(raw: &Value, effective: &mut Value) {
            if let (Some(source), Some(target)) = (raw.as_object(), effective.as_object_mut()) {
                for (key, value) in source {
                    if let Some(known) = target.get_mut(key) {
                        if !["presets", "keybindings", "styleOverrides"].contains(&key.as_str()) {
                            overlay(value, known);
                        }
                    } else {
                        target.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        let mut raw = serde_json::to_value(&self.effective).map_err(io_error)?;
        overlay(&self.raw, &mut raw);
        atomic_write(path, &raw)
    }
}
pub mod write;
