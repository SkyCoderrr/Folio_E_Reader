use e_reader_lib::contract::*;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
fn assert_numeric(a: &Value, b: &Value) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64()),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                assert_numeric(a, b);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len());
            for (k, v) in a {
                assert_numeric(v, b.get(k).unwrap());
            }
        }
        _ => assert_eq!(a, b),
    }
}
fn roundtrip<T: Serialize + DeserializeOwned>(value: &Value) {
    let typed: T = serde_json::from_value(value.clone()).unwrap();
    assert_numeric(&serde_json::to_value(typed).unwrap(), value);
}
#[test]
fn stats_session_save_example() {
    let e: Value = serde_json::from_str(include_str!(
        "../../contract/examples/stats_session_save.json"
    ))
    .unwrap();
    roundtrip::<StatsSessionSaveArgs>(&e["args"]);
    roundtrip::<()>(&e["result"]);
}
#[test]
fn stats_query_example() {
    let e: Value =
        serde_json::from_str(include_str!("../../contract/examples/stats_query.json")).unwrap();
    roundtrip::<StatsQueryArgs>(&e["args"]);
    roundtrip::<StatsQueryResult>(&e["result"]);
}
#[test]
fn book_set_total_chars_example() {
    let e: Value = serde_json::from_str(include_str!(
        "../../contract/examples/book_set_total_chars.json"
    ))
    .unwrap();
    roundtrip::<BookSetTotalCharsArgs>(&e["args"]);
    roundtrip::<()>(&e["result"]);
}
#[test]
fn app_info_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/app_info.json")).unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<AppInfo>(&example["result"]);
}
#[test]
fn m7_stable_examples() {
    for raw in [
        include_str!("../../contract/examples/boss_get_status.json"),
        include_str!("../../contract/examples/boss_set_shortcut.json"),
        include_str!("../../contract/examples/boss_set_enabled.json"),
    ] {
        let example: Value = serde_json::from_str(raw).unwrap();
        roundtrip::<BossKeyStatus>(&example["result"]);
    }
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/dialog_pick_folder.json"
    ))
    .unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<Option<AbsPath>>(&example["result"]);
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/library_set_folder.json"
    ))
    .unwrap();
    roundtrip::<LibrarySetFolderArgs>(&example["args"]);
    roundtrip::<LibrarySetFolderResult>(&example["result"]);
}
#[test]
fn app_quit_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/app_quit.json")).unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn window_get_state_example() {
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/window_get_state.json"
    ))
    .unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<WindowState>(&example["result"]);
}
#[test]
fn window_minimize_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/window_minimize.json")).unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn window_toggle_maximize_example() {
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/window_toggle_maximize.json"
    ))
    .unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn window_start_drag_example() {
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/window_start_drag.json"
    ))
    .unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn window_start_resize_example() {
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/window_start_resize.json"
    ))
    .unwrap();
    roundtrip::<WindowStartResizeArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn window_set_caption_rects_example() {
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/window_set_caption_rects.json"
    ))
    .unwrap();
    roundtrip::<WindowSetCaptionRectsArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn window_set_fullscreen_example() {
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/window_set_fullscreen.json"
    ))
    .unwrap();
    roundtrip::<WindowSetFullscreenArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn kv_get_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/kv_get.json")).unwrap();
    roundtrip::<KvGetArgs>(&example["args"]);
    roundtrip::<JsonValue>(&example["result"]);
}
#[test]
fn kv_set_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/kv_set.json")).unwrap();
    roundtrip::<KvSetArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn settings_get_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/settings_get.json")).unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<Settings>(&example["result"]);
}
#[test]
fn settings_patch_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/settings_patch.json")).unwrap();
    roundtrip::<SettingsPatchArgs>(&example["args"]);
    roundtrip::<Settings>(&example["result"]);
}
#[test]
fn settings_set_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/settings_set.json")).unwrap();
    roundtrip::<SettingsSetArgs>(&example["args"]);
    roundtrip::<Settings>(&example["result"]);
}
#[test]
fn fonts_list_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/fonts_list.json")).unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<Vec<FontFamily>>(&example["result"]);
}
#[test]
fn dialog_pick_books_example() {
    let example: Value = serde_json::from_str(include_str!(
        "../../contract/examples/dialog_pick_books.json"
    ))
    .unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<Vec<AbsPath>>(&example["result"]);
}
#[test]
fn library_import_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/library_import.json")).unwrap();
    roundtrip::<LibraryImportArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn library_list_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/library_list.json")).unwrap();
    roundtrip::<EmptyArgs>(&example["args"]);
    roundtrip::<Vec<BookRecord>>(&example["result"]);
}
#[test]
fn book_get_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/book_get.json")).unwrap();
    roundtrip::<BookIdArgs>(&example["args"]);
    roundtrip::<BookRecord>(&example["result"]);
}
#[test]
fn library_remove_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/library_remove.json")).unwrap();
    roundtrip::<LibraryRemoveArgs>(&example["args"]);
    roundtrip::<LibraryRemoveResult>(&example["result"]);
}
#[test]
fn book_open_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/book_open.json")).unwrap();
    roundtrip::<BookIdArgs>(&example["args"]);
    roundtrip::<BookOpenResult>(&example["result"]);
}
#[test]
fn position_get_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/position_get.json")).unwrap();
    roundtrip::<BookIdArgs>(&example["args"]);
    roundtrip::<Option<Locator>>(&example["result"]);
}
#[test]
fn position_save_example() {
    let example: Value =
        serde_json::from_str(include_str!("../../contract/examples/position_save.json")).unwrap();
    roundtrip::<PositionSaveArgs>(&example["args"]);
    roundtrip::<()>(&example["result"]);
}
#[test]
fn event_examples() {
    let examples: Value =
        serde_json::from_str(include_str!("../../contract/examples/_events.json")).unwrap();
    for payload in examples["app://close-requested"].as_array().unwrap() {
        roundtrip::<()>(payload);
    }
    for payload in examples["window://state-changed"].as_array().unwrap() {
        roundtrip::<WindowState>(payload);
    }
    for payload in examples["window://caption-state"].as_array().unwrap() {
        roundtrip::<CaptionStatePayload>(payload);
    }
    for payload in examples["settings://changed"].as_array().unwrap() {
        roundtrip::<SettingsChangedPayload>(payload);
    }
    for payload in examples["import://item"].as_array().unwrap() {
        roundtrip::<ImportItemPayload>(payload);
    }
    for payload in examples["import://done"].as_array().unwrap() {
        roundtrip::<ImportDonePayload>(payload);
    }
    for payload in examples["boss://hidden"].as_array().unwrap() {
        roundtrip::<BossHiddenPayload>(payload);
    }
    for payload in examples["boss://shown"].as_array().unwrap() {
        roundtrip::<BossShownPayload>(payload);
    }
    for payload in examples["boss://register-failed"].as_array().unwrap() {
        roundtrip::<BossRegisterFailedPayload>(payload);
    }
    for payload in examples["tray://open-library"].as_array().unwrap() {
        roundtrip::<()>(payload);
    }
    for payload in examples["tray://open-settings"].as_array().unwrap() {
        roundtrip::<()>(payload);
    }
}
#[test]
fn txt_and_bookmark_examples() {
    macro_rules! example {
        ($name:literal, $args:ty, $result:ty) => {{
            let e: Value = serde_json::from_str(include_str!(concat!(
                "../../contract/examples/",
                $name,
                ".json"
            )))
            .unwrap();
            roundtrip::<$args>(&e["args"]);
            roundtrip::<$result>(&e["result"]);
        }};
    }
    example!("txt_prepare", BookIdArgs, TxtManifest);
    example!(
        "txt_preview_split",
        TxtPreviewSplitArgs,
        TxtPreviewSplitResult
    );
    example!("txt_prefs_set", TxtPrefsSetArgs, TxtBookPrefs);
    example!("bookmarks_list", BookIdArgs, Vec<Bookmark>);
    example!("bookmark_add", BookmarkAddArgs, Bookmark);
    example!("bookmark_remove", BookmarkRemoveArgs, ());
    example!("chapters_read_get", BookIdArgs, ChaptersReadResult);
    example!("chapter_mark_read", ChapterMarkReadArgs, ChaptersReadResult);
    let preview: Value = serde_json::from_str(include_str!(
        "../../contract/examples/txt_preview_split.json"
    ))
    .unwrap();
    let args: TxtPreviewSplitArgs = serde_json::from_value(preview["args"].clone()).unwrap();
    e_reader_lib::txt::split::regex(&args.chapter_regex, args.heading_max_chars).unwrap();
}
