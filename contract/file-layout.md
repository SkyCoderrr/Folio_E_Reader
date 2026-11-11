# File layout (contract v0.8.0)

Source: PRD §9.1, §10.2, §12.1, §12.5. Windows 11 only.

## 1. Profile root

```
profileDir = E_READER_PROFILE_DIR   if the variable is present and valid (isTestProfile = true)
           = %APPDATA%\com.dany.ereader\   only if the variable is absent (isTestProfile = false)
```

- Resolved **once** in Rust at startup (`src-tauri/src/profile.rs`), required to be an absolute local path suitable for SQLite WAL and WebView2, created if missing and canonicalized once (including equivalent path spellings), and logged at `info` ("profile: <path> (test: true|false)").
- **Every persisted file of the app lives under `profileDir`**, except the book copies in the library folder (§2). App-controlled persistence and the WebView2 user-data folder stay here; shared WebView2 runtime/Windows maintenance writes are outside this guarantee.
- If `E_READER_PROFILE_DIR` is present but empty, whitespace-only, invalid, UNC/network-backed, or cannot be created or written, the app logs the error, shows a native error message box, and exits with code 2. It **never** falls back to the real profile.

```
<profileDir>\
  settings.json                    settings (settings.md); atomic via settings.json.tmp → rename
  settings.json.tmp                transient
  settings.json.bak-v<N>           backup before a settings migration or downgrade load
  settings.json.corrupt-<unixMs>   unparseable settings moved aside
  window-state.json                window size, position, maximized state, monitor (window-state plugin, path pinned here)
  kv.json                          TEMPORARY M1–M3 key/value store (kv_get/kv_set); ignored once kv_* are removed
  import-journal.json              app-created staging/publish ownership for crash recovery
  library.db                       SQLite (WAL) + library.db-wal, library.db-shm (db-schema.md)
  library.db.bak-v<N>              backup before a DB migration
  library\covers\<id>.jpg          cover thumbnails: 300 px wide JPEG, quality 85
  cache\txt\<id>\<paramsHash>\     decoded TXT (M4): manifest.json + s0001.html, s0002.html, …; rebuildable, safe to delete
  logs\                            rotating logs (tauri-plugin-log): e_reader.log, at most 5 files × 1 MB
  webview\                         WebView2 user-data folder (cache, cookies; nothing durable is kept here by design)
```

- Resolve the profile before any persistence plugin or window. Disable config-driven window auto-creation; create `main` programmatically after settings resolution with absolute `WebviewWindowBuilder::data_directory(profileDir.join("webview"))`. Pin logging to `TargetKind::Folder { path: profileDir.join("logs"), ... }` and window-state to `<profile>/window-state.json`; never rely on plugin default paths. Restore size/position/maximized state, never hidden/minimized/fullscreen state.
- **Asset-protocol scope** (commands.md › Book bytes): checked individual library, cover and TXT-cache files. Nothing else under the profile can be read by the webview.
- In a test profile, the default library folder is `<profileDir>\library\`, which also holds `covers\`. That is harmless: book copies are flat `<id>.epub|.txt` files, and nothing in `covers\` matches that pattern. Rust uses DB rows and its import ownership journal for managed-file recovery; a hash-shaped name alone never establishes ownership.

## 2. Library folder (owner decision 2026-11-09)

```
libraryDir = settings.library.folder                       if non-null
           = <Documents known folder>\E_Reader Library      if null and not a test profile
           = <profileDir>\library                           if null and a test profile
```

- "Documents known folder" = `FOLDERID_Documents` via `SHGetKnownFolderPath` (Tauri `document_dir()`), so redirected and OneDrive Documents folders work.
- Created lazily, by the first import (or by `library_set_folder`). Startup never creates it.

```
<libraryDir>\
  <id>.epub | <id>.txt             book copies; <id> = first 32 lowercase hex chars of BLAKE3(file bytes); ext lowercase
  .<id>.<ext>.part                 staged bytes, validated/flushed before publish
  .import-<pid>-<seq>.tmp          per-import staging dir (journal-owned; removed on success or by recovery at startup)
```

- Only book files live here. The DB, settings, positions, covers, cache and logs stay in the profile.
- Rust deletes a file here through `library_remove` or journal-backed interrupted-import cleanup (or moves it with `library_set_folder`). It never deletes or modifies files it did not create. Original files outside the library are never touched (LIB-03, LIB-08).

## 3. Single instance

- One instance per **profile** (WIN-05, PRD §12.5). The key is `com.dany.ereader.` + the first 16 hex chars of BLAKE3(UTF-8 of the lowercased canonical `profileDir`).
- Retain bundle identifier `com.dany.ereader`. Use a `Local\<profile-key>` named mutex (the key above) scoped to the same Windows logon session, held until exit, plus a bounded current-user handoff channel with current-user access control. Do not register the stock identifier-wide single-instance plugin.
- A second launch with the same canonical profile signals show + unminimize + focus, emits `boss://shown { source: "secondInstance" }` if previously hidden, and exits 0. Queue a pending show request if `main` does not exist yet. Different profiles run independently and never focus the owner's window.

## 4. Test-profile rules (PRD §12.5)

- Every automated test and every agent-launched app sets `E_READER_PROFILE_DIR` to a fresh folder, for example `%TEMP%\e_reader_test\<run-id>`. `npm run dev:test` and the e2e runners do it automatically. `cargo test` uses temp dirs (`tempfile`) and passes the path explicitly, without relying on process-wide environment variables.
- In a test profile: `isTestProfile = true`; the library folder defaults to `<profileDir>\library`; `bossKey.enabled` defaults to `false` (settings.md §2); the single-instance key differs from the owner's.
- Agents never read or modify `%APPDATA%\com.dany.ereader\` or `Documents\E_Reader Library`. The tauri-driver smoke suite asserts that neither was created or modified.

## 5. Repository layout and lane ownership

```
E_Reader/
├─ contract/                       THIS contract                               Dany_PM (read-only for agents)
│  └─ examples/                    <command>.json and _events.json             Dany_PM
├─ docs/                           PRD, stories, docs/decisions/ADR-NNN-*.md    Dany_PM (ADRs are written by the lane that runs the spike)
├─ .agent-logs/conversation.md     append-only agent log                        everyone (append only)
├─ vendor/foliate-js/              git submodule, pinned; never edited          Claude Code adds and pins it (M0.3)
├─ vendor/README.md                pinned commit + licence                      Claude Code
├─ src/                            React + TS (PRD §10.2 tree)                  Claude Code
│  └─ ipc/                         commands.ts, events.ts, mocks/              Claude Code
├─ index.html, package.json, package-lock.json, vite.config.ts, tsconfig*.json,
│  eslint/prettier config, vitest config                                        Claude Code
├─ tests/e2e/                      Playwright against Vite + IPC mocks          Claude Code
├─ tests/smoke/                    tauri-driver smoke suite (real app, temp profile)   Claude Code (Codex keeps it green)
├─ tests/fixtures/epub/            public-domain EPUB fixtures (PRD §14.5)      Claude Code
├─ tests/fixtures/txt/             TXT fixtures + generated encodings           Codex
├─ tests/fixtures/cjk/             CJK typography page                          Claude Code
├─ scripts/fixtures/               fixture generator (transcodes TXT corpus)    Codex
├─ src-tauri/                      Rust/Tauri (PRD §10.2 tree)                  Codex
│  ├─ Cargo.toml, Cargo.lock, build.rs, tauri.conf.json, capabilities/, icons/
│  ├─ src/contract/                pasted from contract/rust-types.md
│  ├─ src/settings/                load, write, migrations.rs (settings.md)
│  ├─ src/db/                      mod.rs, migrations.rs, repo.rs
│  └─ tests/                       contract tests (examples round-trip), integration tests
├─ .gitignore, .gitattributes, README.md                                        Dany_PM (agents propose changes in the log)
```

Rules:
- A lane edits only paths it owns. Shared needs (for example a `package.json` script that runs `cargo`) are requested in the log.
- **The contract files are build inputs and are never copied.** The UI imports `contract/types.ts` (tsconfig path alias `@contract/*`) and reads `contract/examples/*.json` and `contract/settings.defaults.json` directly. Rust embeds `contract/settings.defaults.json` with `include_str!`, and its contract tests read `contract/examples/`. `contract/rust-types.md` is the one exception: Codex pastes its code block into `src-tauri/src/contract/` and keeps it identical.
- Nothing under a test profile, `target/`, `node_modules/` or `dist/` is committed (see `.gitignore`).
