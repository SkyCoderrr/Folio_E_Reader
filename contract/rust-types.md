# Rust types (contract v0.9.0)

These are the Rust definitions that match [`types.ts`](types.ts) one-to-one. Every TS type has a Rust type of the **same name**, and every field matches. Codex pastes these into `src-tauri/src/contract/` (for example `contract/mod.rs`, split into files if needed) and does not change names, field types or serde attributes. A change here is a contract change (README › Change process).

Crates: `serde` (derive), `serde_json`, `thiserror`.

## Equivalence rules

| TypeScript | Rust | Notes |
| --- | --- | --- |
| `T \| null` (key always present) | `Option<T>` with no skip attribute | Serialized as `null`. Serde alone also accepts missing keys; raw argument validation rejects missing required nullable keys, including `Locator.cfi` and `globalCharOffset`, before typed conversion. |
| `key?: T` (optional key) | `Option<T>` + `#[serde(default, skip_serializing_if = "Option::is_none")]` | Only in `ReadingStylePatch` and its parts, and `AppError.details`. |
| `MergePatch<…>` (`SettingsPatch`, `TxtPrefsPatch`) | `serde_json::Value` (must be a JSON object) | Needs three states (absent / null / value), so Rust applies RFC 7396 on `Value`, then validates the result as the typed struct. |
| `UnixMs` | `i64` | Integer ms, UTC. |
| integer counts, indices, px, ms, sizes | `u32` (`u64` for `fileSize`, char offsets, `totalChars`, `activeMs`, `charsRead`, `chars`) | README safe integer bounds apply before IPC output and after input. JSON Schema accepts mathematically integral `20.0`; serde integer fields require integer tokens. JS safe integers serialize as integer tokens. |
| fractional numbers (`progress`, em, px/s, ×, `scaleFactor`, `Rect`) | `f64` | |
| `PagesPerView` (`1 \| 2`) | `u8` | Validated to be 1 or 2. |
| string unions | `enum` with serde renames | Spelling is exactly the TS literal. |
| `Partial<Record<ActionId, Chord[]>>` | `BTreeMap<ActionId, Vec<Chord>>` | |
| `JsonValue`, `unknown` | `serde_json::Value` | |
| `null` result or payload | `()` | Commands return `Result<(), AppError>`; events emit `()`. |
| `EmptyArgs` (`{}`) | `EmptyArgs {}` | Only used by contract tests; the command fn has no params. |
| type aliases (`BookId`, `Chord`, `AbsPath`, …) | `pub type X = String;` | Validation lives in the command (patterns in errors.md and settings.schema.json). |

Other rules:
- Structs use `#[serde(rename_all = "camelCase", deny_unknown_fields)]` (except `EmptyArgs` has no fields). Unknown nested fields are rejected; standard named-parameter dispatch ignores unknown top-level invoke keys. Test-only `*Args` structs do not validate the real invoke envelope. Tauri deserialization failures become UI `IPC_ERROR`; domain validation returns `INVALID_ARGUMENT`. The on-disk settings **loader** is the exception: it works on `serde_json::Value`, is lenient and preserves unknown keys (settings.md).
- **Command parameters.** Tauri maps each named parameter of a `#[tauri::command]` fn to a camelCase key of the invoke args object. Parameter names are exactly the fields of its `…Args` struct, in snake_case. Raw validation boundaries below use `Value` before typed conversion. Example: `async fn position_save(state: State<'_, AppState>, book_id: String, locator: serde_json::Value) -> Result<(), AppError>` validates the raw locator, then converts to `Locator`, matching `PositionSaveArgs { bookId, locator }` on the wire. The `…Args` structs exist so the contract tests can round-trip `contract/examples/*.json`.
- **Raw boundaries:** `settings_set` accepts the named `settings: serde_json::Value` parameter, validates the complete raw body against settings.schema.json before converting to `Settings`, and returns `SETTINGS_INVALID.issues` on invalid bodies. This is an intentional exception to the typed parameter rule. `settings_patch` accepts raw `Value`, requires an object, rejects version/unknown paths even when null, applies resets/prunes empty override groups, then validates before conversion. Explicit null in complete `ReadingStylePatch` groups/leaves is invalid; serde `Option` alone cannot enforce this. Raw Locator inputs (e.g. `position_save.locator` and `bookmark_add.locator`) require all keys before typed conversion; missing nullable keys return `INVALID_ARGUMENT`.
- **Contract tests (PRD §14.1).** For every `contract/examples/<command>.json`: deserialize `args` into the command's args type and `result` into its result type, serialize them back, and assert the JSON is equal to the original. Do the same for every entry of `contract/examples/_events.json` with the payload types. `Settings::default()` must equal `contract/settings.defaults.json`.
  - **Compare numbers numerically.** `serde_json` writes an `f64` such as `arrowSpeed` or `progress` as `720.0` / `0.0`, while the examples say `720` / `0`. Plain `serde_json::Value` equality treats those as different. The test therefore compares values recursively and compares any two numbers with `as_f64()`. Key sets, key names, strings, booleans and nulls must still match exactly. (JS parses `720.0` as `720`, so the UI is unaffected.)
- **Strict TS contract check:** compile `types.ts` with strict null checks, assigning the nested reset from `examples/settings_patch.json` (`{styleOverrides:{font:{size:null}}}`) to `SettingsPatch`. Include negative assignments (with `@ts-expect-error`) for string font size and unknown leaf names.
- `impl Default for Settings` = `serde_json::from_str(include_str!("<path to repo>/contract/settings.defaults.json"))`. The defaults are never retyped in Rust.

## Code

```rust
// src-tauri/src/contract/mod.rs — contract v0.9.0. Do not edit; see contract/README.md.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CONTRACT_VERSION: &str = "0.9.0";

// ───────────── Primitives ─────────────
// All integer IPC values must be safe integers (unsigned <= 9007199254740991;
// UnixMs within +/-9007199254740991); narrower field ranges still apply.
// Locator charOffset/globalCharOffset, TxtSection startChar/chars and totalChars
// count UTF-16 code units. Display-string bounds count Unicode scalars.
pub type UnixMs = i64;
pub type BookId = String; // ^[0-9a-f]{32}$
pub type BookmarkId = String; // decimal rowid
pub type JobId = String; // ^[A-Za-z0-9_-]{1,64}$
pub type AbsPath = String;
pub type ColorHex = String;
pub type Chord = String;
pub type PresetId = String;
pub type JsonValue = serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyArgs {}

// ───────────── Errors ─────────────
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidArgument,
    Internal,
    NotImplemented,
    IpcError, // UI-side only; Rust never constructs it
    IoError,
    DbError,
    DbVersionUnsupported,
    WindowOpFailed,
    SettingsInvalid,
    SettingsManagedKey,
    BookNotFound,
    BookFileMissing,
    BookDrmProtected,
    BookFixedLayout,
    EpubInvalid,
    ImportEmptyFile,
    LibraryFolderInvalid,
    TxtDecodeFailed,
    TxtRegexInvalid,
    BookmarkNotFound,
    ShortcutInvalid,
    ShortcutInUse,
    ShortcutRegisterFailed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[error("{code:?}: {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), details: None }
    }
    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}

// ───────────── Locator ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Locator {
    pub section_index: u32,
    pub cfi: Option<String>,
    pub char_offset: u64,
    pub global_char_offset: Option<u64>,
    pub progress: f64,
    pub snippet: String,
}

// ───────────── App ─────────────
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TitleBarMode { Custom, Native }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppInfo {
    pub app_version: String,
    pub contract_version: String,
    pub profile_dir: AbsPath,
    pub library_dir: AbsPath,
    pub library_offline: bool,
    pub is_test_profile: bool,
    pub is_debug_build: bool,
    pub title_bar_mode: TitleBarMode,
}

// ───────────── Window ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowState {
    pub maximized: bool,
    pub minimized: bool,
    pub fullscreen: bool,
    pub focused: bool,
    pub visible: bool,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResizeDirection { North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rect { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptionButton { Minimize, Maximize, Close }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptionRects { pub minimize: Rect, pub maximize: Rect, pub close: Rect }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowStartResizeArgs { pub direction: ResizeDirection }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetCaptionRectsArgs { pub rects: Option<CaptionRects> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetFullscreenArgs { pub fullscreen: bool }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptionStatePayload { pub hovered: Option<CaptionButton>, pub pressed: Option<CaptionButton> }

// ───────────── KV (temporary, M1.5a) ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KvGetArgs { pub key: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KvSetArgs { pub key: String, pub value: JsonValue }

// ───────────── Settings ─────────────
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReaderFlow { Scroll, Paged }

pub type PagesPerView = u8; // 1 | 2

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FontFallback {
    #[serde(rename = "serif")] Serif,
    #[serde(rename = "sans-serif")] SansSerif,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndentMode { Publisher, Force, None }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign { Publisher, Left, Justify }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EpubStyleOverride { Minimal, Balanced, Full }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TxtParagraphMode { Auto, Line, Blank }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryStorageMode { Copy }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryView { Grid, List }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibrarySort { LastRead, Added, Title, Author, Progress }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortDir { Asc, Desc }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryFilter { All, Reading, Unread, Finished }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsPane { General, Reading, Scrolling, Keyboard, Library, TxtCjk, Stats, About }

pub const BUILTIN_PRESET_IDS: [&str; 4] = ["builtin.dark", "builtin.sepia", "builtin.light", "builtin.night"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ActionId {
    #[serde(rename = "scroll.down")] ScrollDown,
    #[serde(rename = "scroll.up")] ScrollUp,
    #[serde(rename = "page.next")] PageNext,
    #[serde(rename = "page.prev")] PagePrev,
    #[serde(rename = "chapter.start")] ChapterStart,
    #[serde(rename = "chapter.end")] ChapterEnd,
    #[serde(rename = "book.start")] BookStart,
    #[serde(rename = "book.end")] BookEnd,
    #[serde(rename = "toc.toggle")] TocToggle,
    #[serde(rename = "bookmarks.show")] BookmarksShow,
    #[serde(rename = "bookmark.toggle")] BookmarkToggle,
    #[serde(rename = "appearance.toggle")] AppearanceToggle,
    #[serde(rename = "chrome.toggle")] ChromeToggle,
    #[serde(rename = "fullscreen.toggle")] FullscreenToggle,
    #[serde(rename = "font.increase")] FontIncrease,
    #[serde(rename = "font.decrease")] FontDecrease,
    #[serde(rename = "font.reset")] FontReset,
    #[serde(rename = "layout.toggleFlow")] LayoutToggleFlow,
    #[serde(rename = "layout.togglePages")] LayoutTogglePages,
    #[serde(rename = "autoscroll.toggle")] AutoscrollToggle,
    #[serde(rename = "book.close")] BookClose,
    #[serde(rename = "dismiss")] Dismiss,
    #[serde(rename = "autoscroll.pause")] AutoscrollPause,
    #[serde(rename = "autoscroll.faster")] AutoscrollFaster,
    #[serde(rename = "autoscroll.slower")] AutoscrollSlower,
    #[serde(rename = "library.import")] LibraryImport,
    #[serde(rename = "library.search")] LibrarySearch,
    #[serde(rename = "library.viewGrid")] LibraryViewGrid,
    #[serde(rename = "library.viewList")] LibraryViewList,
    #[serde(rename = "library.open")] LibraryOpen,
    #[serde(rename = "library.remove")] LibraryRemove,
    #[serde(rename = "library.selectAll")] LibrarySelectAll,
    #[serde(rename = "settings.open")] SettingsOpen,
    #[serde(rename = "app.quit")] AppQuit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleColors { pub background: ColorHex, pub text: ColorHex, pub accent: ColorHex, pub selection: ColorHex }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleFont { pub latin: String, pub cjk: String, pub fallback: FontFallback, pub size: u32, pub weight: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleText {
    pub line_height: f64,
    pub letter_spacing: f64,
    pub paragraph_spacing: f64,
    pub indent_mode: IndentMode,
    pub indent_size: f64,
    pub align: TextAlign,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleLayout { pub margin_x: u32, pub margin_y: u32, pub max_line_width_em: f64, pub page_gap: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleCjk { pub punctuation_trim: bool, pub autospace: bool }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingStyle {
    pub colors: StyleColors,
    pub font: StyleFont,
    pub text: StyleText,
    pub layout: StyleLayout,
    pub cjk: StyleCjk,
}

// Patch types: every field optional and omitted when None.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleColorsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub background: Option<ColorHex>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub text: Option<ColorHex>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub accent: Option<ColorHex>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub selection: Option<ColorHex>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleFontPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub latin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub cjk: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub fallback: Option<FontFallback>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub size: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub weight: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleTextPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub line_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub letter_spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub paragraph_spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub indent_mode: Option<IndentMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub indent_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub align: Option<TextAlign>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleLayoutPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub margin_x: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub margin_y: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub max_line_width_em: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub page_gap: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleCjkPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub punctuation_trim: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub autospace: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingStylePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub colors: Option<StyleColorsPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub font: Option<StyleFontPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub text: Option<StyleTextPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub layout: Option<StyleLayoutPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub cjk: Option<StyleCjkPatch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preset {
    pub id: PresetId,
    pub name: String,
    pub built_in: bool,
    pub style: ReadingStyle,
    pub updated_at: UnixMs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReaderSettings { pub flow: ReaderFlow, pub pages_per_view: PagesPerView }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutSettings { pub min_spread_width_px: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubSettings { pub style_override: EpubStyleOverride }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FooterProgress { Off, Percent, Chapter, Both }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChromeSettings { pub auto_hide_delay_ms: u32, pub footer_progress: FooterProgress }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CursorSettings { pub auto_hide_delay_ms: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScrollSettings {
    pub arrow_speed: f64,
    pub start_ramp_ms: u32,
    pub acceleration: bool,
    pub accel_max: f64,
    pub accel_ramp_ms: u32,
    pub stop_decel_ms: u32,
    pub tap_lines: u32,
    pub page_overlap_lines: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoscrollSettings { pub speed: f64, pub step: u32, pub pause_on_blur: bool }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxtSettings {
    pub chapter_regex: String,
    pub heading_max_chars: u32,
    pub fallback_chunk_chars: u32,
    pub paragraph_mode: TxtParagraphMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibrarySettings {
    pub storage_mode: LibraryStorageMode,
    pub folder: Option<AbsPath>, // managed: library_set_folder only
    pub view: LibraryView,
    pub sort: LibrarySort,
    pub sort_dir: SortDir,
    pub filter: LibraryFilter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSettings { pub title_bar: TitleBarMode }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BossKeySettings { pub enabled: bool, pub shortcut: Chord } // managed: boss_set_* only

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatsSettings { pub enabled: bool, pub idle_timeout_sec: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiSettings { pub settings_last_pane: SettingsPane, pub toc_open: bool }

pub type Keybindings = BTreeMap<ActionId, Vec<Chord>>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub version: u32, // always 1 in contract 0.9.0
    pub active_preset_id: PresetId,
    pub presets: Vec<Preset>,
    pub style_overrides: ReadingStylePatch,
    pub reader: ReaderSettings,
    pub layout: LayoutSettings,
    pub epub: EpubSettings,
    pub chrome: ChromeSettings,
    pub cursor: CursorSettings,
    pub scroll: ScrollSettings,
    pub autoscroll: AutoscrollSettings,
    pub txt: TxtSettings,
    pub library: LibrarySettings,
    pub window: WindowSettings,
    pub boss_key: BossKeySettings,
    pub stats: StatsSettings,
    pub keybindings: Keybindings,
    pub ui: UiSettings,
}

pub type SettingsPatch = serde_json::Value; // RFC 7396 merge patch object

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatchArgs { pub patch: SettingsPatch }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsSetArgs { pub settings: Settings }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsChangedCause { BossKey, LibraryFolder }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsChangedPayload { pub settings: Settings, pub cause: SettingsChangedCause }

// ───────────── Fonts ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontFamily {
    pub family: String,
    pub localized_families: Vec<String>,
    pub cjk: bool,
    pub weights: Vec<u32>,
}

// ───────────── Library and books ─────────────
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookFormat { Epub, Txt }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookRecord {
    pub id: BookId,
    pub format: BookFormat,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub file_name: String,
    pub file_path: AbsPath,
    pub file_size: u64,
    pub file_missing: bool,
    pub cover_path: Option<AbsPath>,
    pub total_chars: Option<u64>,
    pub progress: f64,
    pub added_at: UnixMs,
    pub last_opened_at: Option<UnixMs>,
    pub finished_at: Option<UnixMs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryImportArgs { pub job_id: JobId, pub paths: Vec<AbsPath> }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportOutcome { Added, Duplicate, Unsupported, Failed }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportItemPayload {
    pub job_id: JobId,
    pub index: u32,
    pub total: u32,
    pub path: AbsPath,
    pub file_name: String,
    pub outcome: ImportOutcome,
    pub book: Option<BookRecord>,
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportFailure { pub path: AbsPath, pub file_name: String, pub error: AppError }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportDonePayload {
    pub job_id: JobId,
    pub total: u32,
    pub added: u32,
    pub duplicates: u32,
    pub unsupported: Vec<String>,
    pub failed: Vec<ImportFailure>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookIdArgs { pub book_id: BookId }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryRemoveArgs { pub book_ids: Vec<BookId> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileError { pub book_id: BookId, pub message: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryRemoveResult { pub removed_ids: Vec<BookId>, pub file_errors: Vec<FileError> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubSectionChars {
    pub file_hash: String,
    pub section_chars: Vec<Option<u64>>,
    pub toc_fragment_offsets: BTreeMap<String, u64>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookStatsSeed {
    pub active_ms: u64,
    pub chars: u64,
    pub chars_per_min: Option<f64>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookSetSectionCharsArgs { pub book_id: BookId, pub metrics: EpubSectionChars }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookOpenResult {
    pub book: BookRecord,
    pub locator: Option<Locator>,
    pub txt_prefs: Option<TxtBookPrefs>,
    pub epub_metrics: Option<EpubSectionChars>,
    pub stats_seed: BookStatsSeed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PositionSaveArgs { pub book_id: BookId, pub locator: Locator }

// ───────────── TXT (M4, stable) ─────────────
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TxtEncoding {
    #[serde(rename = "auto")] Auto,
    #[serde(rename = "utf-8")] Utf8,
    #[serde(rename = "utf-16le")] Utf16Le,
    #[serde(rename = "utf-16be")] Utf16Be,
    #[serde(rename = "gb18030")] Gb18030,
    #[serde(rename = "big5")] Big5,
    #[serde(rename = "shift_jis")] ShiftJis,
    #[serde(rename = "euc-kr")] EucKr,
    #[serde(rename = "windows-1252")] Windows1252,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxtBookPrefs {
    pub encoding: TxtEncoding,
    pub detected_encoding: Option<TxtEncoding>,
    pub chapter_regex: Option<String>,
    pub heading_max_chars: Option<u32>,
    pub paragraph_mode: Option<TxtParagraphMode>,
}

pub type TxtPrefsPatch = serde_json::Value; // RFC 7396 merge patch object

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxtPrefsSetArgs { pub book_id: BookId, pub patch: TxtPrefsPatch }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxtSection { pub index: u32, pub title: String, pub path: AbsPath, pub start_char: u64, pub chars: u64 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxtManifest {
    pub book_id: BookId,
    pub encoding: TxtEncoding,
    pub detected_encoding: TxtEncoding,
    pub lang: String,
    pub total_chars: u64,
    pub sections: Vec<TxtSection>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxtPreviewSplitArgs { pub book_id: BookId, pub chapter_regex: String, pub heading_max_chars: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxtPreviewSplitResult { pub count: u32, pub first20: Vec<String> }

// ───────────── Bookmarks (M5, stable) ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub id: BookmarkId,
    pub book_id: BookId,
    pub locator: Locator,
    pub progress: f64,
    pub chapter_title: Option<String>,
    pub snippet: Option<String>,
    pub created_at: UnixMs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookmarkAddArgs {
    pub book_id: BookId,
    pub locator: Locator,
    pub chapter_title: Option<String>,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChaptersReadResult { pub chapter_keys: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChapterMarkReadArgs { pub book_id: BookId, pub chapter_key: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookmarkRemoveArgs { pub bookmark_id: BookmarkId }

// ───────────── Boss key, tray (M7) ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BossKeyStatus { pub enabled: bool, pub shortcut: Chord, pub registered: bool, pub error: Option<AppError> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BossSetShortcutArgs { pub shortcut: Chord }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BossSetEnabledArgs { pub enabled: bool }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HideSource { BossKey, Tray }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShowSource { BossKey, Tray, SecondInstance }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BossHiddenPayload { pub source: HideSource }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BossShownPayload { pub source: ShowSource }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BossRegisterFailedPayload { pub shortcut: Chord, pub error: AppError }

// ───────────── Library folder (M7, stable) ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibrarySetFolderArgs { pub path: Option<AbsPath>, pub move_files: bool }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibrarySetFolderResult { pub library_dir: AbsPath, pub moved: u32, pub failed: Vec<FileError> }

// ───────────── Stats (M8, stable) ─────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingSessionInput {
    pub book_id: BookId,
    pub started_at: UnixMs,
    pub ended_at: UnixMs,
    pub active_ms: u64,
    pub chars_read: u64,
    pub start_progress: f64,
    pub end_progress: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatsSessionSaveArgs { pub session: ReadingSessionInput }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatsQueryArgs { pub from_day: String, pub to_day: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatsDay { pub day: String, pub active_ms: u64, pub chars: u64 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatsBook { pub book_id: BookId, pub title: String, pub active_ms: u64, pub chars: u64, pub progress: f64, pub last_read_at: Option<UnixMs>, pub chars_per_min: Option<f64>, pub finished: bool }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatsQueryResult { pub days: Vec<StatsDay>, pub books: Vec<StatsBook>, pub totals: StatsTotals }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatsTotals { pub active_ms: u64, pub chars: u64 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookSetTotalCharsArgs { pub book_id: BookId, pub total_chars: u64 }

// Rect: unzoomed viewport CSS px at zoom 1; finite, positive dimensions,
// non-overlapping and within viewport. Rust maps signed screen/client origins,
// applying DPI conversion once.
// LibraryRemoveResult: removed_ids unique in input order; file_errors aggregates
// copy/cover/cache cleanup failures once per book. Import total includes synthetic
// traversal failures and is fixed before the first item.
// ───────────── Event names ─────────────
pub mod event {
    pub const APP_CLOSE_REQUESTED: &str = "app://close-requested";
    pub const WINDOW_STATE_CHANGED: &str = "window://state-changed";
    pub const WINDOW_CAPTION_STATE: &str = "window://caption-state";
    pub const SETTINGS_CHANGED: &str = "settings://changed";
    pub const IMPORT_ITEM: &str = "import://item";
    pub const IMPORT_DONE: &str = "import://done";
    pub const BOSS_HIDDEN: &str = "boss://hidden";
    pub const BOSS_SHOWN: &str = "boss://shown";
    pub const BOSS_REGISTER_FAILED: &str = "boss://register-failed";
    pub const TRAY_OPEN_LIBRARY: &str = "tray://open-library";
    pub const TRAY_OPEN_SETTINGS: &str = "tray://open-settings";
}
```

## Name map (TS → Rust)

Every exported TS type in `types.ts` has a Rust item of the same name above, except these TS-only helpers: `CONTRACT_VERSION` (Rust const of the same name), `ERROR_CODES`, `SETTINGS_PANES`, `ACTION_IDS` (arrays behind the unions; in Rust these are enums), `BuiltinPresetId` (Rust: `BUILTIN_PRESET_IDS`), `MergePatch<T>` (Rust: `serde_json::Value`), `Commands`, `CommandName`, `CommandArgs`, `CommandResult`, `Events`, `EventName`, `EventPayload` (UI-side typing only; Rust registers the fns in `lib.rs` and uses `event::*`).
