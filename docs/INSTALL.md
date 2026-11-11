# Installing Folio 1.0.0-rc.1

> 2026-11-11 - Owner decision t25u: the app is now **Folio**. Existing profile and library paths are preserved; changing the default `Documents\E_Reader Library` path requires a later owner decision.

Build on Windows with `npm run tauri build -- --bundles nsis`. The installer is
`src-tauri/target/release/bundle/nsis/Folio_1.0.0-rc.1_x64-setup.exe` by default.
If the running development/release executable locks that target, use PowerShell:

```powershell
$env:E_READER_PROFILE_DIR = Join-Path $PWD '.test-profile\packaging'
$env:CARGO_TARGET_DIR = Join-Path $PWD '.test-profile\m9-target'
npm run tauri build -- --bundles nsis
```

The alternate installer is under `.test-profile/m9-target/release/bundle/nsis/`.
Building does not launch the application or install it. Dany_PM runs the installer
outside the sandbox. This release candidate is unsigned.

The installer product name, Start menu/desktop shortcuts and uninstall display
entry are **Folio**. The generated NSIS script retains `e-reader.exe` as the
installed binary; its Windows `FileDescription` and `ProductName` are **Folio**.
The Cargo development path stays `src-tauri\target\release\e-reader.exe`.

Bundler tools use `bundle.useLocalToolsDir = true`, keeping the NSIS tool cache in
the Cargo target directory's `.tauri/` instead of the protected per-user cache.

NSIS installs for the current Windows user (no machine-wide installation). The
installer downloads and runs the Microsoft Evergreen WebView2 bootstrapper when a
runtime is needed; it does not bundle a fixed runtime. Initial runtime setup may
therefore require an internet connection. The installed reader has no online catalogue.

Imported books are copied into the visible `Documents\E_Reader Library` folder
(the Windows Documents known folder, which may be redirected). Settings › Library
can change that path. The originals remain untouched. Settings, `library.db`,
positions, bookmarks, caches, logs, WebView data and window state live in the app
profile, normally `%APPDATA%\com.dany.ereader`.

**Upgrade and default uninstall retain both the library folder and the app profile.**
Leave the NSIS uninstaller's optional **Delete app data** checkbox unchecked to keep
the profile. Selecting it explicitly deletes the profile (including progress and
bookmarks); it does not target the separate Documents library folder. Upgrades
skip that deletion branch. Keeping the profile retains settings, progress and
bookmarks across reinstall. There are no custom data-deletion hooks. Native
install/upgrade/uninstall retention still needs Dany_PM's isolated verification
before release sign-off.

For every test or benchmark set `E_READER_PROFILE_DIR` to an absolute path under
`.test-profile/`. This redirects the entire profile and the default library folder
to `<profile>\library`; test profiles disable the boss key by default. Never use
the owner's actual profile or Documents library for acceptance checks.

Performance check (outside the sandbox, foreground window, release exe):

```powershell
node scripts/perf-run.mjs --exe .test-profile/m9-target/release/e-reader.exe --epub C:\fixtures\representative-5mb.epub --hz 144
```

Repeat at actual 60/120/144 Hz display settings. Each run writes JSON and a Markdown
pass/fail table under `.test-profile/perf/<timestamp>/`. It generates a ≥10 MB
GB18030 fixture from the public-domain source, imports only into its own profile,
and checks first-open/cached-open, arrow frames/long tasks and paged turns. The
default EPUB is a smaller smoke fixture; the runner explicitly leaves the 5 MB
target unmeasured unless a suitable EPUB is supplied. CDP and paint-opportunity
timings are conservative presentation proxies, not GPU presentation traces.
Unmeasured PRD §11 scenarios are listed explicitly, never counted as passes.
