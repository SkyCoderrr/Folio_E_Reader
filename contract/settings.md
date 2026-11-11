# Settings (contract v0.8.0)

Source: PRD §8 (the closed list of v1 settings) and §9.2. Files:

| File | Role |
| --- | --- |
| [`settings.schema.json`](settings.schema.json) | JSON Schema (draft 2020-12) of the **complete effective** settings object. It is authoritative for types, ranges and enums. |
| [`settings.defaults.json`](settings.defaults.json) | The full default object. Rust embeds it (`include_str!`) and the UI imports it. Nobody retypes defaults. |
| [`types.ts`](types.ts) › `Settings`, [`rust-types.md`](rust-types.md) › `Settings` | Typed mirrors. |
| this file | Behaviour: load, write, patch, managed keys, migration, built-in presets, default keymap, chords. |

## 1. Ownership

- **Rust is the only reader and writer of `<profile>\settings.json`.** The minimal profile-aware loader, defaults, repairs and migrations belong to M0.1; M2 adds generic writes and full validation/UI. It loads the file at startup, before the window is created, because it needs `bossKey.*`, `library.folder` and `window.titleBar` before any UI exists.
- The UI reads settings with `settings_get` and writes with `settings_patch` (or `settings_set`). It never touches the file and never stores durable state in `localStorage` or IndexedDB.
- Rust owns load-time defaults merge, clamping and migration. The UI always receives a complete, valid `Settings`. The UI's settings store (M2.1b) keeps the in-memory copy, clamps user input to the schema ranges **before** sending, and debounces writes by 300 ms (RS-10).

## 2. Effective object vs file

- **Effective object** = what `settings_get` returns: every key present, every value valid against the schema. `version` is the settings schema version (always `1` in this contract).
- **File** = `settings.json` as it is on disk. Hand-editing is supported. It may omit keys (defaults fill them in), may contain values out of range (they are clamped), and may contain unknown keys (they are preserved on write but never returned).

### Profile-dependent defaults
`settings.defaults.json` holds the defaults for the owner's real profile. Two defaults depend on the profile (PRD §9.1, §12.5):

| Key | Real profile | Test profile (`E_READER_PROFILE_DIR` set) |
| --- | --- | --- |
| `library.folder` | `null` → resolved to `<Documents known folder>\E_Reader Library` | `null` → resolved to `<profile>\library` |
| `bossKey.enabled` | `true` | `false`. If the file says `true` explicitly, or `boss_set_enabled(true)` is called, it is enabled ("unless explicitly enabled"). |

`E_READER_PROFILE_DIR` absent selects the real profile. A present empty/whitespace/invalid/unwritable or UNC/network profile override shows a native startup error and exits 2, never falling back (file-layout.md).

Unavailable custom roots remain configured; startup continues offline (`app_info.libraryOffline`), books report missing and imports fail with `LIBRARY_FOLDER_INVALID`. No automatic reset is persisted. Reparse/unreadable child entries are skipped individually and never granted.

`library.folder = null` always means "the default rule". The resolved path is reported by `app_info.libraryDir`.

### Canonical library path boundary

Use one native validator during settings load and `library_set_folder`: require an absolute drive path or UNC server **and share**, reject device paths and NUL, and resolve junctions/reparse points using path components rather than string prefixes (including existing ancestors of a not-yet-created root). Reject roots equal to or ancestors of `profileDir`, and roots equal to or within `<profile>/cache` or `<profile>/library/covers`. Account for reparse targets within recursively granted roots so a grant cannot expose settings/DB through an alias. `<profile>/library` is allowed. Load repairs an invalid `library.folder` to null; `library_set_folder` returns `LIBRARY_FOLDER_INVALID`. Validate before every asset grant, including the resolved default; settings/DB must remain denied in scope tests.

### In-page reading progress (owner t31u)

`chrome.footerProgress` belongs to chrome because it controls reader presentation, independently of reading-style presets (scope G). `off` hides the readout; `percent` shows book percentage; `chapter` shows current/total chapters (for example 6/24); `both` shows both. The readout lives in the existing in-page footer and remains visible while chrome is hidden; it creates no extra bar. Changes apply live through the existing settings commands/events.

Contract 0.8.0 keeps settings schema version 1: existing files missing `chrome.footerProgress` load as `off` through the defaults merge, preserve other values/unknown keys, and persist the new key on the next settings change. Invalid on-disk values repair to `off`; invalid IPC writes return `SETTINGS_INVALID`. A null patch resets it to `off`.

## 3. Load (startup, lenient)

1. Missing file: use the defaults (with the profile rules above). Do not write the file until the first change.
2. Unparseable JSON: rename it to `settings.json.corrupt-<unixMs>`, log a warning, and use the defaults.
3. `version` missing: treat as 1. `version` lower than the current version: run the migrations (§7). `version` higher than supported (a downgrade): copy the file once to `settings.json.bak-v<N>`, log a warning, and load it as the current version.
4. Merge the file over the defaults, key by key, and repair each known key on its own (log every repair at `warn`):
   - Wrong JSON type, unknown enum value, bad colour, bad path → the default for that key.
   - A number out of range → clamped to the nearest bound. An integer key with a fraction → rounded half away from zero, then clamped. For "0 or range" keys (`layout.maxLineWidthEm`, `cursor.autoHideDelayMs`): ≤ 0 → 0; between 0 and the minimum → the minimum; above the maximum → the maximum.
   - `txt.chapterRegex` that does not compile, or is longer than 1000 chars → the default.
   - `keybindings`: unknown action ids (including retired section-stepping ids) are dropped from the effective object. Invalid chords are dropped. Duplicates are removed. Only the first 3 chords are kept.
   - `presets`: invalid entries and entries with duplicate ids are dropped.
   - `styleOverrides`: invalid or unknown keys are dropped. Empty sub-objects are removed.
   - `activePresetId` that is not a built-in id and not in `presets` → `"builtin.dark"`.
   - `bossKey.shortcut` that is not a valid boss chord → `"Ctrl+Alt+B"`.
5. Repairs are **not** written back at startup. They are written with the next change. Migrations (step 3) are written at once.

## 4. Write (atomic)

- Rust writes the **full effective object** (all known keys, in the key order of `settings.defaults.json`), pretty-printed with 2-space indentation, UTF-8 without BOM, with a trailing newline.
- Unknown keys found in the file at any depth are preserved, by overlaying the effective object onto the raw file object. Exception: the values of `presets`, `keybindings` and `styleOverrides` are written exactly as in the effective object, with nothing preserved inside them.
- Writes go to `settings.json.tmp` in the same folder, which is flushed and then renamed over `settings.json`. A crash leaves either the old or the new file.
- If the new effective object equals the current one, nothing is written.
- Writes are serialized in Rust (one mutex). The UI keeps **at most one settings write in flight**: it awaits each call before sending the next.

## 5. Commands (strict)

`settings_set.settings` is validated as raw JSON against the complete schema **before** serde conversion; invalid types/nulls/version/patterns return `SETTINGS_INVALID.issues`, not an early Tauri string. Complete settings permit omission in sparse overrides but never explicit null there; null resets belong only to merge-patch input. `settings_patch` and `settings_set` validate strictly. Nothing is clamped or repaired. Any violation rejects the call with `SETTINGS_INVALID` and nothing changes. `details.issues` lists every problem as `{ path: "reader.pagesPerView", message }`. Checks:
- the schema (types, ranges, enums, patterns, no unknown keys, `presets[].builtIn = false`);
- `activePresetId` is a built-in id or the id of an entry in `presets`;
- preset ids are unique;
- `txt.chapterRegex` compiles with fancy-regex (multiline);
- every chord matches the grammar (§10); `bossKey.shortcut` also follows the boss rule.

### Merge-patch semantics (`settings_patch`)
`patch` is a JSON Merge Patch (RFC 7396) applied to the current effective object:
- an absent key is unchanged;
- an object merges recursively;
- an array replaces the old array (for example `presets`, or a chord list);
- **`null` resets the key to its default**: `{"reader": {"flow": null}}` → `"scroll"`; `{"keybindings": {"page.next": null}}` → back to the default chords for that action; `{"keybindings": null}` → all default keybindings; `{"styleOverrides": {"font": {"size": null}}}` → the font size follows the preset again (the reset dot); `{"styleOverrides": null}` → Revert.
- The raw patch must be an object. `version` and unknown paths are rejected even with null values, before deletion can hide them.
- `version` must not appear in a patch.

After merging, prune empty override groups; any removed key is filled in from the defaults (with the profile rules), and the result is validated as a whole. Examples: switching the preset and clearing the overrides is one patch, `{"activePresetId": "builtin.sepia", "styleOverrides": null}`. Deleting the active custom preset must also change `activePresetId` in the same patch.

### Managed keys
`bossKey.enabled`, `bossKey.shortcut` and `library.folder` need side effects (OS hotkey registration, asset scope, moving files). They are changed **only** by `boss_set_enabled`, `boss_set_shortcut` and `library_set_folder`. A `settings_patch` or `settings_set` that would give a managed key a value different from its current one rejects with `SETTINGS_MANAGED_KEY` (`details.keys: string[]`). When a managed key changes through its command, Rust persists it and emits `settings://changed` (events.md).

### `settings://changed`
This event is emitted only for changes that the backend makes (managed keys). It is **not** emitted for `settings_patch` or `settings_set`, whose callers get the new object as the result. So the UI never receives an echo of its own writes.

## 6. Reading style: presets + overrides

- The rendered style = the active preset's `style`, deep-merged with `styleOverrides`.
- **Modified** (RS-09) = `styleOverrides` is not empty. **Revert** = patch `{"styleOverrides": null}`. **Update** (custom presets only) = write the merged style into that preset's `style`, bump its `updatedAt` and clear the overrides, all in one patch. **Save as Preset** = append a new custom preset with the merged style, make it active and clear the overrides, all in one patch.
- Editing a built-in preset and saving creates a custom preset named "<name> (custom)" (RS-08). Built-ins are never stored in or removed from `settings.json`.
- Per-control **reset dot** = remove that key from `styleOverrides`. `Ctrl+0` = remove `styleOverrides.font.size`.
- Custom preset ids: `custom.` + 1–64 chars of `[A-Za-z0-9_-]`, generated by the UI (for example `custom.` + a random UUID without braces). Names are 1–60 chars and not blank. Name uniqueness is a UI rule.

### Built-in presets (UI code, `src/engine/style/readingStyle.ts`; values from PRD §6.3)
All four share: `font = { latin: "Sitka Text", cjk: "Microsoft YaHei", fallback: "serif", size: 20, weight: 400 }`, `text = { lineHeight: 1.75, letterSpacing: 0, paragraphSpacing: 0.5, indentMode: "publisher", indentSize: 2, align: "justify" }`, `layout = { marginX: 48, marginY: 40, maxLineWidthEm: 36, pageGap: 48 }`, `cjk = { punctuationTrim: true, autospace: true }`. Selection = the accent at 32% alpha (`52` hex).

| id | name | background | text | accent | selection |
| --- | --- | --- | --- | --- | --- |
| `builtin.dark` (default) | Dark | `#17181B` | `#D6D1C7` | `#D9A55B` | `#D9A55B52` |
| `builtin.sepia` | Sepia | `#F3EAD7` | `#3A2F23` | `#8A4B14` | `#8A4B1452` |
| `builtin.light` | Light | `#FAF9F6` | `#1E1E1C` | `#7A4A0C` | `#7A4A0C52` |
| `builtin.night` | Night (low contrast) | `#0D0D0E` | `#8C867C` | `#A07C48` | `#A07C4852` |

Built-ins are `Preset` objects with `builtIn: true` and `updatedAt: 0`.

## 7. Migration rule

- `version` is the settings schema version. It is bumped only when an existing key changes meaning, type or location, or is removed. **Adding a key with a default does not bump it**, because defaults merge in on load.
- Migrations live in Rust (`src-tauri/src/settings/migrations.rs`). They are pure `serde_json::Value` → `Value` functions, one per step (`v1 → v2`, …), run in order on load. Before migrating, Rust copies the file to `settings.json.bak-v<old>`, then writes the migrated file at once.
- Every version bump is a contract change: new schema, defaults, types and a changelog entry in README.md.

## 8. Key table (summary; the schema is authoritative)

| Key | Type | Default | Range / options |
| --- | --- | --- | --- |
| `version` | 1 | `1` | — |
| `activePresetId` | PresetId | `"builtin.dark"` | built-in or custom id |
| `presets` | Preset[] | `[]` | custom only |
| `styleOverrides` | ReadingStylePatch | `{}` | ranges as ReadingStyle |
| `reader.flow` | enum | `"scroll"` | `scroll`, `paged` |
| `reader.pagesPerView` | 1 \| 2 | `1` | 2 is opt-in only; never set automatically |
| `layout.minSpreadWidthPx` | int px | `1000` | 600–3000 |
| `epub.styleOverride` | enum | `"balanced"` | `minimal`, `balanced`, `full` |
| `chrome.footerProgress` | enum | `"off"` | `off`, `percent`, `chapter`, `both`; global (G) |
| `chrome.autoHideDelayMs` | int ms | `2000` | 500–10000 |
| `cursor.autoHideDelayMs` | int ms | `1500` | 0 (never) or 500–10000 |
| `scroll.arrowSpeed` | px/s | `720` | 60–4000 |
| `scroll.startRampMs` | int ms | `80` | 0–400 |
| `scroll.acceleration` | bool | `true` | — |
| `scroll.accelMax` | × | `2.5` | 1–6 |
| `scroll.accelRampMs` | int ms | `800` | 100–4000 |
| `scroll.stopDecelMs` | int ms | `100` | 0–500 |
| `scroll.tapLines` | int | `3` | 1–10 |
| `scroll.pageOverlapLines` | int | `2` | 0–10 |
| `autoscroll.speed` | px/s | `40` | 5–400 |
| `autoscroll.step` | int % | `10` | 1–50 |
| `autoscroll.pauseOnBlur` | bool | `true` | — |
| `txt.chapterRegex` | string | PRD §8.4 default | compiles; ≤ 1000 chars |
| `txt.headingMaxChars` | int | `40` | 4–100 |
| `txt.fallbackChunkChars` | int | `10000` | 2000–100000 |
| `txt.paragraphMode` | enum | `"auto"` | `auto`, `line`, `blank` |
| `library.storageMode` | `"copy"` | `"copy"` | only `copy` in v1 |
| `library.folder` | path \| null | `null` (default rule) | managed (`library_set_folder`) |
| `library.view` | enum | `"grid"` | `grid`, `list` |
| `library.sort` | enum | `"lastRead"` | `lastRead`, `added`, `title`, `author`, `progress` |
| `library.sortDir` | enum | `"desc"` | `asc`, `desc` |
| `library.filter` | enum | `"all"` | `all`, `reading`, `unread`, `finished` |
| `window.titleBar` | enum | `"custom"` | `custom`, `native` (restart required) |
| `bossKey.enabled` | bool | `true` (test profile: `false`) | managed (`boss_set_enabled`) |
| `bossKey.shortcut` | chord | `"Ctrl+Alt+B"` | boss rule; managed (`boss_set_shortcut`) |
| `stats.enabled` | bool | `true` | — |
| `stats.idleTimeoutSec` | int s | `180` | 30–900 |
| `keybindings` | map | `{}` (diffs only) | ≤ 3 unique chords per action; `[]` = unbound |
| `ui.settingsLastPane` | enum | `"general"` | `general`, `reading`, `scrolling`, `keyboard`, `library`, `txtCjk`, `stats`, `about` |
| `ui.tocOpen` | bool | `false` | — |

ReadingStyle (preset fields, defaults = Dark): `colors.background` `#17181B` · `colors.text` `#D6D1C7` · `colors.accent` `#D9A55B` · `colors.selection` `#D9A55B52` · `font.latin` "Sitka Text" · `font.cjk` "Microsoft YaHei" · `font.fallback` serif (`serif`, `sans-serif`) · `font.size` 20 (10–72) · `font.weight` 400 (100–900) · `text.lineHeight` 1.75 (1.0–3.0) · `text.letterSpacing` 0 (−0.05–0.30) · `text.paragraphSpacing` 0.5 (0–3) · `text.indentMode` publisher (`publisher`, `force`, `none`) · `text.indentSize` 2 (0–4) · `text.align` justify (`publisher`, `left`, `justify`) · `layout.marginX` 48 (0–400) · `layout.marginY` 40 (0–200) · `layout.maxLineWidthEm` 36 (0 or 15–120) · `layout.pageGap` 48 (0–200) · `cjk.punctuationTrim` true · `cjk.autospace` true. Slider steps are the `x-step` annotations in the schema.

Per-book TXT values (`txt.encoding`, and overrides of `chapterRegex`, `headingMaxChars`, `paragraphMode`) are **not** settings. They live in the DB table `book_prefs` (`TxtBookPrefs`, M4).

## 9. Default keymap (UI code `src/engine/input/keymap.ts`; PRD §7)

`keybindings` in settings stores only the differences from this table. For an action listed in `keybindings`, its chord list replaces the default list.

| Scope | Action → default chords |
| --- | --- |
| reader | `scroll.down` → `ArrowDown` · `scroll.up` → `ArrowUp` · `page.next` → `PageDown`, `Space`, `ArrowRight` · `page.prev` → `PageUp`, `Shift+Space`, `ArrowLeft` · `chapter.start` → `Home` · `chapter.end` → `End` · `book.start` → `Ctrl+Home` · `book.end` → `Ctrl+End` · `toc.toggle` → `T` · `bookmarks.show` → `Ctrl+B` · `bookmark.toggle` → `Ctrl+D` · `appearance.toggle` → `A` · `chrome.toggle` → `H` · `fullscreen.toggle` → `F11` · `font.increase` → `Ctrl+Equal`, `Ctrl+NumpadAdd` · `font.decrease` → `Ctrl+Minus` · `font.reset` → `Ctrl+0` · `layout.toggleFlow` → `M` · `layout.togglePages` → `D` · `autoscroll.toggle` → `S` · `book.close` → `Ctrl+W` · `dismiss` → `Escape` |
| reader.autoscroll | `autoscroll.pause` → `Space` · `autoscroll.faster` → `Equal` · `autoscroll.slower` → `Minus` |
| library | `library.import` → `Ctrl+O` · `library.search` → `Ctrl+F` · `library.viewGrid` → `Ctrl+1` · `library.viewList` → `Ctrl+2` · `library.open` → `Enter` · `library.remove` → `Delete` · `library.selectAll` → `Ctrl+A` |
| app | `settings.open` → `Ctrl+Comma` · `app.quit` → `Ctrl+Q` |
| global (OS) | boss key → `bossKey.shortcut` (`Ctrl+Alt+B`), not part of `keybindings` |

Reserved chords (the UI rejects them when recording; PRD §7): `Alt+F4`, `Alt+Tab`, `Ctrl+Alt+Delete`, anything with the Win key (not expressible in the grammar), and `F12` in debug builds. Conflict detection is a UI rule.

## 10. Chords

Grammar (also the `Chord` pattern in the schema):

```
chord     = [ "Ctrl+" ] [ "Alt+" ] [ "Shift+" ] key
key       = KeyboardEvent.code, except KeyA..KeyZ → "A".."Z" and Digit0..Digit9 → "0".."9"
```

- Allowed keys: `A`–`Z`, `0`–`9`, `F1`–`F24`, `Numpad0`–`Numpad9`, `NumpadAdd`, `NumpadSubtract`, `NumpadMultiply`, `NumpadDivide`, `NumpadDecimal`, `NumpadEnter`, `ArrowUp/Down/Left/Right`, `PageUp`, `PageDown`, `Home`, `End`, `Insert`, `Delete`, `Backspace`, `Enter`, `Tab`, `Escape`, `Space`, `Backquote`, `Minus`, `Equal`, `BracketLeft`, `BracketRight`, `Backslash`, `Semicolon`, `Quote`, `Comma`, `Period`, `Slash`, `IntlBackslash`, `IntlRo`, `IntlYen`, `Pause`, `ScrollLock`, `PrintScreen`, `ContextMenu`.
- Modifier order is fixed (Ctrl, Alt, Shift), which is also the Windows display order. Meta/Win is never part of a chord.
- Local `keybindings` name **physical keys** (KB-05). The UI shows them using the current keyboard layout (for example `Ctrl+Equal` may display as `Ctrl+=`).
- **Boss rule** (WIN-04): a boss chord has at least one modifier, or is exactly `Pause`, `ScrollLock` or `F13`–`F24`. `Ctrl+Alt+Space` is never a default.
- The global boss key is limited to unambiguous Windows-supported tokens; `NumpadEnter` (aliases Enter), `IntlBackslash`, `IntlRo`, `IntlYen` and `ContextMenu` are rejected; reject unsupported/ambiguous tokens with `SHORTCUT_INVALID`. Global behavior can depend on keyboard layout. Toggle only on `ShortcutState::Pressed`, never release. No elevation is required; reserved/occupied chords are normal errors.
- Rust passes a boss chord to `tauri-plugin-global-shortcut` by mapping each token to its `Code` (`B` → `KeyB`, `1` → `Digit1`, others unchanged).

Integer values obey the safe-integer limits in README, including `Preset.updatedAt` (0..9007199254740991). String length bounds count Unicode scalars (`A😀` = 2), while reading offsets/counts use UTF-16 code units (`A😀` = 3).
