use e_reader_lib::{contract::*, kv::KvStore, profile::Profile, settings};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};
fn profile() -> (tempfile::TempDir, Profile) {
    let temp = tempfile::Builder::new()
        .prefix("ereader-test-")
        .tempdir()
        .unwrap();
    let p = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("Real profile must not be resolved")
    })
    .unwrap();
    (temp, p)
}
#[test]
fn every_path_is_under_override() {
    let (_temp, p) = profile();
    for path in [
        &p.settings,
        &p.database,
        &p.kv,
        &p.logs,
        &p.webview,
        &p.cache,
        &p.covers,
        &p.window_state,
    ] {
        assert!(path.starts_with(&p.root));
    }
    assert!(p.is_test);
    assert_eq!(
        p.default_library(|| panic!("Documents must not be queried"))
            .unwrap(),
        p.root.join("library")
    );
    assert!(!p.root.join("library").exists());
}
#[test]
fn invalid_overrides_never_fall_back() {
    for value in [
        "",
        "  ",
        "relative",
        r"\\server\share",
        r"\\?\C:\test",
        "C:\0bad\n",
    ] {
        assert!(Profile::resolve(Some(value.into()), || panic!("No fallback")).is_err());
    }
}
#[test]
fn absent_override_alone_uses_real_resolution() {
    let temp = tempfile::Builder::new()
        .prefix("ereader-test-")
        .tempdir()
        .unwrap();
    let p = Profile::resolve(None, || Ok(temp.path().join("simulated-real"))).unwrap();
    assert!(!p.is_test);
    assert_eq!(
        p.default_library(|| Ok(temp.path().join("fake-documents")))
            .unwrap(),
        temp.path().join("fake-documents/E_Reader Library")
    );
}
#[test]
fn equivalent_profiles_have_same_instance_key() {
    let (_temp, p) = profile();
    let other = Profile::resolve(Some(p.root.join(".").into_os_string()), || panic!()).unwrap();
    assert_eq!(p.key(), other.key());
    let (_other, p2) = profile();
    assert_ne!(p.key(), p2.key());
    let expected = blake3::hash(p.root.to_string_lossy().to_lowercase().as_bytes()).to_hex();
    assert_eq!(p.key(), format!("com.dany.ereader.{}", &expected[..16]));
}
#[test]
fn library_guard_protects_profile_and_internal_roots() {
    let (_temp, p) = profile();
    for path in [
        &p.root,
        p.root.parent().unwrap(),
        &p.cache,
        &p.cache.join("txt"),
        &p.covers,
        &p.covers.join("nested"),
    ] {
        assert!(p.validate_library(path).is_err(), "{}", path.display());
    }
    assert!(p.validate_library(&p.root.join("library")).is_ok());
    assert!(
        p.validate_library(&p.root.join("../outside-library"))
            .is_ok()
    );
    assert!(p.validate_library(&PathBuf::from("relative")).is_err());
}
#[test]
fn library_guard_resolves_existing_ancestors() {
    let (_temp, p) = profile();
    assert!(
        p.validate_library(&p.root.join("library/../cache/future"))
            .is_err()
    );
    assert!(p.validate_library(&p.root.join("cache/../library")).is_ok());
}
#[test]
fn kv_roundtrip_replace_delete_and_reopen() {
    let (_temp, p) = profile();
    let store = KvStore::open(p.kv.clone()).unwrap();
    assert_eq!(store.get("position:test").unwrap(), Value::Null);
    store
        .set("position:test", json!({"progress":0.2,"snippet":"中文"}))
        .unwrap();
    store.set("other", json!([true, 3])).unwrap();
    let reopened = KvStore::open(p.kv.clone()).unwrap();
    assert_eq!(
        reopened.get("position:test").unwrap(),
        json!({"progress":0.2,"snippet":"中文"})
    );
    store.set("position:test", Value::Null).unwrap();
    assert_eq!(
        KvStore::open(p.kv).unwrap().get("position:test").unwrap(),
        Value::Null
    );
}
#[test]
fn kv_rejects_invalid_args_without_mutation() {
    let (_temp, p) = profile();
    let store = KvStore::open(p.kv.clone()).unwrap();
    for key in ["", "bad key", "../x", "中文"] {
        assert_eq!(
            store.set(key, json!(1)).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
    assert!(store.set("large", json!("a".repeat(65537))).is_err());
    assert!(!p.kv.exists());
}
#[test]
fn kv_corruption_is_quarantined() {
    let (_temp, p) = profile();
    fs::write(&p.kv, b"not json").unwrap();
    let store = KvStore::open(p.kv.clone()).unwrap();
    assert_eq!(store.get("key").unwrap(), Value::Null);
    assert!(!p.kv.exists());
    assert!(fs::read_dir(&p.root).unwrap().any(|v| {
        v.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("kv.json.corrupt-")
    }));
}
#[test]
fn kv_failed_write_leaves_memory_unchanged() {
    let (_temp, p) = profile();
    let store = KvStore::open(p.kv.clone()).unwrap();
    store.set("key", json!(1)).unwrap();
    fs::create_dir(p.root.join("kv.json.tmp")).unwrap();
    assert!(store.set("key", json!(2)).is_err());
    assert_eq!(store.get("key").unwrap(), json!(1));
    assert_eq!(KvStore::open(p.kv).unwrap().get("key").unwrap(), json!(1));
}
#[test]
fn app_error_shape() {
    assert_eq!(
        serde_json::to_value(AppError::new(ErrorCode::IoError, "failed")).unwrap(),
        json!({"code":"IO_ERROR","message":"failed"})
    );
    assert_eq!(
        serde_json::to_value(
            AppError::new(ErrorCode::InvalidArgument, "bad")
                .with_details(json!({"field":"key","reason":"empty"}))
        )
        .unwrap(),
        json!({"code":"INVALID_ARGUMENT","message":"bad","details":{"field":"key","reason":"empty"}})
    );
}
#[test]
fn embedded_defaults_match_contract() {
    let expected: Value =
        serde_json::from_str(include_str!("../../contract/settings.defaults.json")).unwrap();
    assert_numbers(
        &serde_json::to_value(Settings::default()).unwrap(),
        &expected,
    );
}
#[test]
fn fresh_test_settings_are_safe_and_not_written() {
    let (_temp, p) = profile();
    let loaded = settings::load(&p, || panic!()).unwrap();
    assert!(!loaded.effective.boss_key.enabled);
    assert_eq!(loaded.effective.reader.pages_per_view, 1);
    assert_eq!(loaded.library_dir, p.root.join("library"));
    assert!(!p.settings.exists());
    assert!(!loaded.library_dir.exists());
}
#[test]
fn settings_repairs_are_in_memory_until_next_write() {
    let (_temp, p) = profile();
    let raw = json!({"future":{"value":9},"scroll":{"arrowSpeed":99999,"tapLines":2.5,"future":true},"cursor":{"autoHideDelayMs":200},"reader":{"flow":"bogus"},"bossKey":{"enabled":true,"shortcut":"B"},"library":{"folder":p.root},"styleOverrides":{"font":{"size":1,"unknown":2},"unknown":{}},"txt":{"chapterRegex":"["},"keybindings":{"unknown":["A"],"page.next":["A","A","B","C","D","bad"]},"activePresetId":"custom.missing"});
    fs::write(&p.settings, serde_json::to_vec(&raw).unwrap()).unwrap();
    let loaded = settings::load(&p, || panic!()).unwrap();
    assert_eq!(loaded.effective.scroll.arrow_speed, 4000.0);
    assert_eq!(loaded.effective.scroll.tap_lines, 3);
    assert_eq!(loaded.effective.cursor.auto_hide_delay_ms, 500);
    assert!(loaded.effective.boss_key.enabled);
    assert_eq!(loaded.effective.boss_key.shortcut, "Ctrl+Alt+B");
    assert_eq!(loaded.effective.active_preset_id, "builtin.dark");
    assert_eq!(loaded.effective.library.folder.as_deref(), p.root.to_str());
    assert_eq!(
        loaded.effective.style_overrides.font.as_ref().unwrap().size,
        Some(10)
    );
    assert_eq!(loaded.effective.keybindings.len(), 1);
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&p.settings).unwrap()).unwrap(),
        raw
    );
    loaded.write(&p.settings).unwrap();
    let written: Value = serde_json::from_slice(&fs::read(p.settings).unwrap()).unwrap();
    assert_eq!(written["future"]["value"], 9);
    assert_eq!(written["scroll"]["future"], true);
    assert!(written["styleOverrides"]["font"].get("unknown").is_none());
}
#[test]
fn retired_section_bindings_are_dropped_on_load_and_next_write() {
    let (_temp, p) = profile();
    let raw = json!({"keybindings": {
        "chapter.next": ["BracketRight", "Ctrl+PageDown"],
        "chapter.prev": ["BracketLeft", "Ctrl+PageUp"],
        "page.next": ["PageDown"],
        "page.prev": []
    }});
    fs::write(&p.settings, serde_json::to_vec(&raw).unwrap()).unwrap();
    let loaded = settings::load(&p, || panic!()).unwrap();
    let expected = json!({"page.next": ["PageDown"], "page.prev": []});
    assert_eq!(
        serde_json::to_value(&loaded.effective.keybindings).unwrap(),
        expected
    );
    // Startup repair stays in memory; the next settings write removes old ids.
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&p.settings).unwrap()).unwrap(),
        raw
    );
    loaded.write(&p.settings).unwrap();
    let written: Value = serde_json::from_slice(&fs::read(&p.settings).unwrap()).unwrap();
    assert_eq!(written["keybindings"], expected);
}

#[test]
fn malformed_settings_quarantined() {
    let (_temp, p) = profile();
    fs::write(&p.settings, b"{").unwrap();
    assert!(settings::load(&p, || panic!()).is_ok());
    assert!(!p.settings.exists());
}
#[test]
fn newer_settings_backed_up_once() {
    let (_temp, p) = profile();
    fs::write(&p.settings, b"{\"version\":2,\"future\":42}").unwrap();
    let loaded = settings::load(&p, || panic!()).unwrap();
    assert_eq!(loaded.effective.version, 1);
    assert!(p.root.join("settings.json.bak-v2").exists());
    let written: Value = serde_json::from_slice(&fs::read(p.settings).unwrap()).unwrap();
    assert_eq!(written["future"], 42);
    assert_eq!(written["version"], 1);
}
fn assert_numbers(a: &Value, b: &Value) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64()),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                assert_numbers(a, b);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len());
            for (k, v) in a {
                assert_numbers(v, b.get(k).unwrap());
            }
        }
        _ => assert_eq!(a, b),
    }
}
#[test]
fn asset_scope_denies_profile_settings_and_database() {
    let (_temp, p) = profile();
    let app = tauri::test::mock_app();
    let scope =
        tauri::scope::fs::Scope::new(&app, &tauri::utils::config::FsScope::AllowedPaths(vec![]))
            .unwrap();
    let library = p.validate_library(&p.root.join("library")).unwrap();
    fs::create_dir_all(&p.covers).unwrap();
    fs::write(&p.settings, b"{}").unwrap();
    fs::write(&p.database, b"test").unwrap();
    fs::write(p.cache.join("section.html"), b"test").unwrap();
    fs::write(library.join("book.epub"), b"test").unwrap();
    for dir in [&library, &p.cache, &p.covers] {
        for file in e_reader_lib::profile::library_files(dir) {
            scope.allow_file(file).unwrap();
        }
    }
    assert!(!scope.is_allowed(&p.root));
    assert!(!scope.is_allowed(&p.settings));
    assert!(!scope.is_allowed(p.covers.join("escape/settings.json")));
    assert!(!scope.is_allowed(&p.database));
    assert!(scope.is_allowed(p.cache.join("section.html")));
    assert!(scope.is_allowed(library.join("book.epub")));
}
#[test]
fn settings_integer_enum_and_zero_range_repair() {
    let (_temp, p) = profile();
    fs::write(&p.settings,br#"{"reader":{"pagesPerView":1.5},"cursor":{"autoHideDelayMs":0},"styleOverrides":{"layout":{"maxLineWidthEm":0}}}"#).unwrap();
    let loaded = settings::load(&p, || panic!()).unwrap();
    assert_eq!(loaded.effective.reader.pages_per_view, 2);
    assert_eq!(loaded.effective.cursor.auto_hide_delay_ms, 0);
    assert_eq!(
        loaded
            .effective
            .style_overrides
            .layout
            .unwrap()
            .max_line_width_em,
        Some(0.0)
    );
}
#[cfg(windows)]
fn junction(link: &std::path::Path, target: &std::path::Path) {
    use std::os::windows::process::CommandExt;
    let output=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","New-Item -ItemType Junction -Path $env:E_READER_TEST_LINK -Target $env:E_READER_TEST_TARGET | Out-Null"]).env("E_READER_TEST_LINK",link).env("E_READER_TEST_TARGET",target).creation_flags(0x08000000).output().unwrap();
    assert!(
        output.status.success(),
        "junction: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
#[cfg(windows)]
#[test]
fn internal_cache_alias_to_profile_root_is_rejected() {
    let temp = tempfile::Builder::new()
        .prefix("ereader-test-")
        .tempdir()
        .unwrap();
    let root = temp.path().join("profile");
    fs::create_dir(&root).unwrap();
    junction(&root.join("cache"), &root);
    assert!(Profile::resolve(Some(root.into_os_string()), || panic!()).is_err());
}
#[cfg(windows)]
#[test]
fn recursive_library_alias_is_skipped_without_aborting_settings_load() {
    let (_temp, p) = profile();
    let library = p.root.join("library");
    fs::create_dir(&library).unwrap();
    junction(&library.join("escape"), &p.root);
    assert!(p.validate_library(&library).is_ok());
    assert!(settings::load(&p, || panic!()).is_ok());
    fs::create_dir_all(&p.covers).unwrap();
    junction(&p.covers.join("escape"), &p.root);
    let safe = library.join("safe.txt");
    fs::write(&safe, "safe").unwrap();
    let app = tauri::test::mock_app();
    let scope =
        tauri::scope::fs::Scope::new(&app, &tauri::utils::config::FsScope::AllowedPaths(vec![]))
            .unwrap();
    for file in e_reader_lib::profile::library_files(&library) {
        scope.allow_file(file).unwrap();
    }
    assert!(scope.is_allowed(&safe));
    assert!(!scope.is_allowed(library.join("escape/settings.json")));
    assert!(!scope.is_allowed(p.covers.join("escape/settings.json")));
    assert!(!scope.is_allowed(&p.settings));
    assert!(
        p.validate_library(&library.join("escape/new-folder"))
            .is_err()
    );
    // Resolving a direct alias to the root is forbidden independently of tree walking.
    assert!(p.validate_library(&library.join("escape")).is_err());
}

#[cfg(windows)]
#[test]
fn unreadable_file_is_skipped_without_granting_or_aborting_the_library() {
    use std::os::windows::process::CommandExt;
    let (_temp, p) = profile();
    let root = p.root.join("library");
    fs::create_dir(&root).unwrap();
    let id = "c".repeat(32);
    let unreadable = root.join(format!("{id}.txt"));
    let safe = root.join("safe.txt");
    fs::write(&unreadable, "private").unwrap();
    fs::write(&safe, "safe").unwrap();
    let db = e_reader_lib::db::Database::open(p.clone(), root.clone());
    db.insert(&e_reader_lib::db::NewBook {
        id: id.clone(),
        format: "txt".into(),
        title: "unreadable".into(),
        author: None,
        language: None,
        file_name: "unreadable.txt".into(),
        file_size: 7,
        cover: false,
        metadata: json!({}),
    })
    .unwrap();
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:E_READER_TEST_FILE; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::ReadData,[System.Security.AccessControl.AccessControlType]::Deny); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:E_READER_TEST_FILE -AclObject $acl"])
        .env("E_READER_TEST_FILE", &unreadable).creation_flags(0x08000000).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(fs::File::open(&unreadable).is_err());
    assert!(settings::load(&p, || panic!()).is_ok());
    assert!(p.validate_library(&root).is_ok());
    assert_eq!(e_reader_lib::profile::library_files(&root), vec![safe]);
    assert!(db.list().unwrap()[0].file_missing);
    assert_eq!(
        db.open_book(&id).unwrap_err().code,
        ErrorCode::BookFileMissing
    );
    db.position_save(&id, json!({"sectionIndex":0,"cfi":null,"charOffset":7,"globalCharOffset":7,"progress":0.5,"snippet":"saved"})).unwrap();
    // The denial applies only to ReadData. TempDir can still delete this file.
}

#[test]
fn missing_custom_library_is_preserved_and_reported_offline() {
    use e_reader_lib::{
        db::{Database, NewBook},
        import::{Library, journal::Journal, pipeline},
    };
    let (temp, p) = profile();
    let custom = temp.path().join("unmounted-library");
    fs::create_dir(&custom).unwrap();
    let input = json!({"version":1,"library":{"folder":custom.to_string_lossy()}});
    fs::write(&p.settings, serde_json::to_vec(&input).unwrap()).unwrap();
    let db = Database::open(p.clone(), custom.clone());
    db.require_existing_library(true);
    db.insert(&NewBook {
        id: "a".repeat(32),
        format: "txt".into(),
        title: "offline".into(),
        author: None,
        language: None,
        file_name: "book.txt".into(),
        file_size: 10,
        cover: false,
        metadata: json!({}),
    })
    .unwrap();
    fs::remove_dir(&custom).unwrap();
    let mut loaded = settings::load(&p, || panic!()).unwrap();
    assert_eq!(loaded.effective.library.folder.as_deref(), custom.to_str());
    assert_eq!(loaded.library_dir, custom);
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&p.settings).unwrap()).unwrap(),
        input
    );
    assert!(db.library_offline());
    assert!(db.list().unwrap()[0].file_missing);
    loaded
        .change(&p.settings, json!({"stats":{"enabled":false}}), true, true)
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&p.settings).unwrap()).unwrap()["library"]["folder"],
        input["library"]["folder"]
    );
    let source = temp.path().join("source.txt");
    fs::write(&source, "test").unwrap();
    assert_eq!(
        pipeline::item(&db, &mut Journal::load(&db).unwrap(), &source)
            .unwrap_err()
            .code,
        ErrorCode::LibraryFolderInvalid
    );
    let library = Library::start(db, |_| {});
    assert_eq!(
        library
            .enqueue(
                "offline".into(),
                vec![source.to_string_lossy().into_owned()]
            )
            .unwrap_err()
            .code,
        ErrorCode::LibraryFolderInvalid
    );
    assert!(
        !custom.exists(),
        "import recreated an unavailable custom root"
    );
    // The same runtime and a fresh launch both recover without a settings edit.
    fs::create_dir(&custom).unwrap();
    fs::write(custom.join(format!("{}.txt", "a".repeat(32))), "restored").unwrap();
    assert!(!library.db.library_offline());
    assert!(!library.db.list().unwrap()[0].file_missing);
    let reloaded = settings::load(&p, || panic!()).unwrap();
    let reopened = Database::open(p.clone(), reloaded.library_dir);
    reopened.require_existing_library(true);
    assert!(!reopened.library_offline());
    assert_eq!(reopened.list().unwrap().len(), 1);
    assert!(!reopened.list().unwrap()[0].file_missing);
    assert_eq!(
        pipeline::item(
            &library.db,
            &mut Journal::load(&library.db).unwrap(),
            &source
        )
        .unwrap()
        .0,
        ImportOutcome::Added
    );
    assert_eq!(library.db.list().unwrap().len(), 2);
    library.close();
}

#[test]
fn unavailable_default_root_starts_offline_and_does_not_reset_books_or_settings() {
    use e_reader_lib::{
        db::{Database, NewBook},
        import::{Library, journal::Journal, pipeline},
    };
    let (temp, p) = profile();
    let root = p.default_library(|| panic!()).unwrap();
    let input = json!({"version":1,"library":{"folder":null}});
    fs::write(&p.settings, serde_json::to_vec(&input).unwrap()).unwrap();
    fs::write(&root, "not a folder").unwrap();
    let loaded = settings::load(&p, || panic!()).unwrap();
    assert_eq!(loaded.library_dir, root);
    assert_eq!(loaded.effective.library.folder, None);
    let db = Database::open(p.clone(), loaded.library_dir);
    assert!(db.library_offline());
    let source = temp.path().join("source.txt");
    fs::write(&source, "source").unwrap();
    assert_eq!(
        pipeline::item(&db, &mut Journal::load(&db).unwrap(), &source)
            .unwrap_err()
            .code,
        ErrorCode::LibraryFolderInvalid
    );
    let library = Library::start(db, |_| {});
    assert_eq!(
        library
            .enqueue(
                "offline".into(),
                vec![source.to_string_lossy().into_owned()]
            )
            .unwrap_err()
            .code,
        ErrorCode::LibraryFolderInvalid
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&p.settings).unwrap()).unwrap(),
        input
    );
    library.close();
    fs::remove_file(&root).unwrap();
    let db = Database::open(p.clone(), root.clone());
    // A first-use default is creatable. A missing root with existing books is offline.
    assert!(!db.library_offline());
    db.insert(&NewBook {
        id: "b".repeat(32),
        format: "txt".into(),
        title: "retained".into(),
        author: None,
        language: None,
        file_name: "retained.txt".into(),
        file_size: 1,
        cover: false,
        metadata: json!({}),
    })
    .unwrap();
    assert!(db.library_offline());
    assert!(db.list().unwrap()[0].file_missing);
    assert_eq!(
        pipeline::item(&db, &mut Journal::load(&db).unwrap(), &source)
            .unwrap_err()
            .code,
        ErrorCode::LibraryFolderInvalid
    );
    assert!(!root.exists());
    fs::create_dir(&root).unwrap();
    fs::write(root.join(format!("{}.txt", "b".repeat(32))), "retained").unwrap();
    assert!(!db.library_offline());
    assert!(!db.list().unwrap()[0].file_missing);
}
