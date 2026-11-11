use e_reader_lib::{
    contract::ErrorCode,
    profile::Profile,
    settings::{self, LoadedSettings},
};
use serde_json::{Value, json};
use std::fs;
fn fixture() -> (tempfile::TempDir, Profile, LoadedSettings) {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.test-profile/codex-footer-settings");
    fs::create_dir_all(&root).unwrap();
    let temp = tempfile::tempdir_in(root).unwrap();
    let profile = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("real profile")
    })
    .unwrap();
    let loaded = settings::load(&profile, || panic!("Documents")).unwrap();
    (temp, profile, loaded)
}
#[test]
fn footer_progress_existing_file_defaults_and_persists_on_next_change() {
    let (_temp, profile, settings) = fixture();
    let mut old = serde_json::to_value(settings.effective).unwrap();
    old["chrome"]
        .as_object_mut()
        .unwrap()
        .remove("footerProgress");
    old["chrome"]["autoHideDelayMs"] = json!(3456);
    old["chrome"]["future"] = json!("preserve");
    let bytes = serde_json::to_vec(&old).unwrap();
    fs::write(&profile.settings, &bytes).unwrap();
    let mut loaded = settings::load(&profile, || panic!("Documents")).unwrap();
    assert_eq!(
        serde_json::to_value(&loaded.effective).unwrap()["chrome"]["footerProgress"],
        "off"
    );
    assert_eq!(loaded.effective.chrome.auto_hide_delay_ms, 3456);
    assert_eq!(fs::read(&profile.settings).unwrap(), bytes);
    loaded
        .change(
            &profile.settings,
            json!({"reader":{"pagesPerView":2}}),
            true,
            true,
        )
        .unwrap();
    let saved: Value = serde_json::from_slice(&fs::read(&profile.settings).unwrap()).unwrap();
    assert_eq!(saved["chrome"]["footerProgress"], "off");
    assert_eq!(saved["chrome"]["future"], "preserve");
    assert_eq!(saved["chrome"]["autoHideDelayMs"], 3456);
    assert_eq!(
        settings::load(&profile, || panic!("Documents"))
            .unwrap()
            .effective,
        loaded.effective
    );
}

#[test]
fn footer_progress_all_modes_patch_set_and_reload() {
    let (_temp, profile, mut loaded) = fixture();
    for mode in ["percent", "chapter", "both", "off"] {
        let result = loaded
            .change(
                &profile.settings,
                json!({"chrome":{"footerProgress":mode}}),
                true,
                true,
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(&result).unwrap()["chrome"]["footerProgress"],
            mode
        );
        assert_eq!(
            settings::load(&profile, || panic!("Documents"))
                .unwrap()
                .effective,
            result
        );
    }
    for mode in ["percent", "chapter", "both", "off"] {
        let mut next = serde_json::to_value(&loaded.effective).unwrap();
        next["chrome"]["footerProgress"] = json!(mode);
        let result = loaded.change(&profile.settings, next, false, true).unwrap();
        assert_eq!(
            settings::load(&profile, || panic!("Documents"))
                .unwrap()
                .effective,
            result
        );
        assert_eq!(
            serde_json::to_value(result).unwrap()["chrome"]["footerProgress"],
            mode
        );
    }
    loaded
        .change(
            &profile.settings,
            json!({"chrome":{"footerProgress":"both"}}),
            true,
            true,
        )
        .unwrap();
    let reset = loaded
        .change(
            &profile.settings,
            json!({"chrome":{"footerProgress":null}}),
            true,
            true,
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(&reset).unwrap()["chrome"]["footerProgress"],
        "off"
    );
    assert_eq!(
        settings::load(&profile, || panic!("Documents"))
            .unwrap()
            .effective,
        reset
    );
}

#[test]
fn footer_progress_invalid_writes_are_atomic_and_complete_set_requires_key() {
    let (_temp, profile, mut loaded) = fixture();
    loaded
        .change(
            &profile.settings,
            json!({"chrome":{"footerProgress":"both"}}),
            true,
            true,
        )
        .unwrap();
    let before = loaded.effective.clone();
    let bytes = fs::read(&profile.settings).unwrap();
    for invalid in [
        json!("percentage"),
        json!("OFF"),
        json!(""),
        json!(true),
        json!(1),
        json!({}),
        json!([]),
    ] {
        for patch in [true, false] {
            let mut input = if patch {
                json!({"chrome":{}})
            } else {
                serde_json::to_value(&before).unwrap()
            };
            input["chrome"]["footerProgress"] = invalid.clone();
            let error = loaded
                .change(&profile.settings, input, patch, true)
                .unwrap_err();
            assert_eq!(error.code, ErrorCode::SettingsInvalid);
            assert!(
                error.details.unwrap()["issues"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|issue| issue["path"] == "chrome.footerProgress")
            );
        }
    }
    for remove in [true, false] {
        let mut input = serde_json::to_value(&before).unwrap();
        if remove {
            input["chrome"]
                .as_object_mut()
                .unwrap()
                .remove("footerProgress");
        } else {
            input["chrome"]["footerProgress"] = Value::Null;
        }
        assert_eq!(
            loaded
                .change(&profile.settings, input, false, true)
                .unwrap_err()
                .code,
            ErrorCode::SettingsInvalid
        );
    }
    assert_eq!(loaded.effective, before);
    assert_eq!(fs::read(&profile.settings).unwrap(), bytes);
}

#[test]
fn footer_progress_invalid_disk_values_repair_only_the_new_key() {
    let (_temp, profile, _settings) = fixture();
    for invalid in [
        json!("percentage"),
        json!(null),
        json!(false),
        json!(17),
        json!({}),
        json!([]),
    ] {
        fs::write(
            &profile.settings,
            serde_json::to_vec(
                &json!({"version":1,"chrome":{"autoHideDelayMs":3456,"footerProgress":invalid}}),
            )
            .unwrap(),
        )
        .unwrap();
        let loaded = settings::load(&profile, || panic!("Documents")).unwrap();
        assert_eq!(
            serde_json::to_value(loaded.effective).unwrap()["chrome"],
            json!({"autoHideDelayMs":3456,"footerProgress":"off"})
        );
    }
}
#[test]
fn startup_repairs_unsupported_windows_boss_tokens_without_enabling_test_default() {
    let (_temp, profile, _settings) = fixture();
    for chord in [
        "Ctrl+IntlBackslash",
        "Ctrl+NumpadEnter",
        "Ctrl+ContextMenu",
        "B",
        "Alt+Ctrl+B",
    ] {
        fs::write(
            &profile.settings,
            serde_json::to_vec(&json!({"version":1,"bossKey":{"shortcut":chord}})).unwrap(),
        )
        .unwrap();
        let loaded = settings::load(&profile, || panic!()).unwrap();
        assert_eq!(loaded.effective.boss_key.shortcut, "Ctrl+Alt+B");
        assert!(!loaded.effective.boss_key.enabled);
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&profile.settings).unwrap()).unwrap()["bossKey"]
                ["shortcut"],
            chord
        );
    }
}
#[test]
fn roundtrip_unknowns_and_no_unchanged_write() {
    let (_t, p, mut s) = fixture();
    s.raw = json!({"future":{"a":1},"reader":{"future":true},"styleOverrides":{"future":1},"keybindings":{"future":[]}});
    s.change(&p.settings, json!({}), true, true).unwrap();
    assert!(!p.settings.exists());
    let expected = s
        .change(
            &p.settings,
            json!({"reader":{"pagesPerView":2}}),
            true,
            true,
        )
        .unwrap();
    let bytes = fs::read(&p.settings).unwrap();
    assert_eq!(bytes.last(), Some(&b'\n'));
    let raw: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(raw["future"], json!({"a":1}));
    assert_eq!(raw["reader"]["future"], true);
    assert_eq!(raw["styleOverrides"], json!({}));
    assert_eq!(raw["keybindings"], json!({}));
    let reloaded = settings::load(&p, || panic!("Documents")).unwrap();
    assert_eq!(reloaded.effective, expected);
    // A blocked temporary path proves unchanged writes do not even attempt IO.
    fs::create_dir(p.settings.with_extension("json.tmp")).unwrap();
    s.change(
        &p.settings,
        json!({"reader":{"pagesPerView":2}}),
        true,
        true,
    )
    .unwrap();
    assert_eq!(fs::read(&p.settings).unwrap(), bytes);
}
#[test]
fn failed_atomic_write_leaves_memory_and_disk_unchanged() {
    let (_t, p, mut s) = fixture();
    s.change(
        &p.settings,
        json!({"reader":{"pagesPerView":2}}),
        true,
        true,
    )
    .unwrap();
    let before = s.effective.clone();
    let bytes = fs::read(&p.settings).unwrap();
    fs::create_dir(p.settings.with_extension("json.tmp")).unwrap();
    assert!(
        s.change(
            &p.settings,
            json!({"reader":{"pagesPerView":1}}),
            true,
            true
        )
        .is_err()
    );
    assert_eq!(s.effective, before);
    assert_eq!(fs::read(&p.settings).unwrap(), bytes);
}
#[test]
fn strict_errors_collect_paths_and_leave_no_file() {
    let (_t, p, mut s) = fixture();
    let e = s.change(&p.settings,json!({"reader":{"pagesPerView":3},"scroll":{"arrowSpeed":0},"styleOverrides":{"font":{"size":2}}}),true,true).unwrap_err();
    assert_eq!(e.code, ErrorCode::SettingsInvalid);
    let issues = e.details.unwrap()["issues"].as_array().unwrap().clone();
    for path in [
        "reader.pagesPerView",
        "scroll.arrowSpeed",
        "styleOverrides.font.size",
    ] {
        assert!(issues.iter().any(|i| i["path"] == path), "{issues:?}");
    }
    assert!(!p.settings.exists());
}
#[test]
fn rejects_managed_keys_and_all_unknown_patch_paths_even_null() {
    let (_t, p, mut s) = fixture();
    for patch in [
        json!({"bossKey":{"enabled":true}}),
        json!({"bossKey":{"shortcut":"Ctrl+Alt+K"}}),
        json!({"library":{"folder":"C:\\Books"}}),
    ] {
        assert_eq!(
            s.change(&p.settings, patch, true, true).unwrap_err().code,
            ErrorCode::SettingsManagedKey
        );
    }
    for patch in [
        json!(null),
        json!([]),
        json!({"version":null}),
        json!({"unknown":null}),
        json!({"styleOverrides":{"font":{"unknown":null}}}),
        json!({"keybindings":{"retired":null}}),
    ] {
        assert_eq!(
            s.change(&p.settings, patch, true, true).unwrap_err().code,
            ErrorCode::SettingsInvalid
        );
    }
    assert!(!p.settings.exists());
}
#[test]
fn nulls_reset_profile_defaults_and_prune_overrides() {
    let (_t, p, mut s) = fixture();
    s.change(&p.settings,json!({"reader":{"flow":"paged"},"styleOverrides":{"font":{"size":25}},"keybindings":{"page.next":["X"]}}),true,true).unwrap();
    s.change(&p.settings,json!({"reader":{"flow":null},"styleOverrides":{"font":{"size":null}},"keybindings":{"page.next":null},"bossKey":{"enabled":null}}),true,true).unwrap();
    let v = serde_json::to_value(&s.effective).unwrap();
    assert_eq!(v["reader"]["flow"], "scroll");
    assert_eq!(v["styleOverrides"], json!({}));
    assert_eq!(v["keybindings"], json!({}));
    assert_eq!(v["bossKey"]["enabled"], false);
}
#[test]
fn every_settings_example_passes_strict_validation_and_roundtrips() {
    let (_t, p, mut s) = fixture();
    for text in [
        include_str!("../../contract/examples/settings_get.json"),
        include_str!("../../contract/examples/settings_patch.json"),
        include_str!("../../contract/examples/settings_set.json"),
    ] {
        let example: Value = serde_json::from_str(text).unwrap();
        let result = s
            .change(&p.settings, example["result"].clone(), false, true)
            .unwrap();
        assert_eq!(
            settings::load(&p, || panic!("Documents"))
                .unwrap()
                .effective,
            result
        );
        if let Some(patch) = example["args"].get("patch") {
            s.change(&p.settings, patch.clone(), true, true).unwrap();
        }
        if let Some(settings) = example["args"].get("settings") {
            s.change(&p.settings, settings.clone(), false, true)
                .unwrap();
        }
    }
}
#[test]
fn complete_set_rejects_nulls_missing_fields_bad_regex_and_invalid_presets() {
    let (_t, p, mut s) = fixture();
    let good = serde_json::to_value(&s.effective).unwrap();
    for (pointer, value) in [
        ("/version", json!(2)),
        ("/reader/pagesPerView", json!(null)),
        ("/styleOverrides", json!({"font":{"size":null}})),
        ("/txt/chapterRegex", json!("[")),
        ("/activePresetId", json!("custom.absent")),
        ("/keybindings", json!({"page.next":["X","X"]})),
        ("/bossKey/shortcut", json!("B")),
    ] {
        let mut next = good.clone();
        *next.pointer_mut(pointer).unwrap() = value;
        assert_eq!(
            s.change(&p.settings, next, false, true).unwrap_err().code,
            ErrorCode::SettingsInvalid
        );
    }
    let mut next = good;
    next.as_object_mut().unwrap().remove("reader");
    assert_eq!(
        s.change(&p.settings, next, false, true).unwrap_err().code,
        ErrorCode::SettingsInvalid
    );
    assert!(!p.settings.exists());
}
#[test]
fn schema_integer_numbers_normalize_before_serde() {
    let (_t, p, mut s) = fixture();
    let mut value = serde_json::to_value(&s.effective).unwrap();
    value["version"] = json!(1.0);
    value["reader"]["pagesPerView"] = json!(2.0);
    value["styleOverrides"] = json!({"font":{"size":25.0}});
    let result = s.change(&p.settings, value, false, true).unwrap();
    assert_eq!(result.reader.pages_per_view, 2);
    assert_eq!(result.style_overrides.font.unwrap().size, Some(25));
}
#[test]
fn duplicate_presets_and_invalid_names_are_reported() {
    let (_t, p, mut s) = fixture();
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/settings_get.json")).unwrap();
    let preset = example["result"]["presets"][0].clone();
    let mut other = preset.clone();
    other["name"] = json!(" ");
    other["builtIn"] = json!(true);
    let e = s
        .change(&p.settings, json!({"presets":[preset,other]}), true, true)
        .unwrap_err();
    let issues = e.details.unwrap()["issues"].as_array().unwrap().clone();
    for path in ["presets[1].id", "presets[1].name", "presets[1].builtIn"] {
        assert!(issues.iter().any(|i| i["path"] == path), "{issues:?}");
    }
    assert!(!p.settings.exists());
}
