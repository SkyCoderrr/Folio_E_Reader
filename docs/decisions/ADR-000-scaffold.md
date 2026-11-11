# ADR-000: Foundation scaffold

Date: 2026-11-09. Status: implemented against contract 0.2.0; native visual smoke remains subject to the restricted runner limitation below.

## Decision

Use React/React DOM 19.3.1, TypeScript 6.0.3 (strict), Vite 8.3.7, Vitest 5.1.0, ESLint 10.14.0, typescript-eslint 8.72.2, Prettier 3.9.10 and Tauri JS/CLI 2.12.4. Lockfiles fix the resolved versions; package.json uses compatible ranges. TypeScript paths work without the deprecated baseUrl option. The optional ESLint no-useless-assignment style rule is disabled for guarded DOM initialization; TypeScript unused/type checks remain enabled.

Rust uses Tauri 2.12.5, tauri-runtime 2.12.2, tauri-build 2.7.4, log plugin 2.10.1, windows 0.62.2 and webview2-com 0.39.1 (matching Tauri's COM bindings). Other foundation dependencies: serde/serde_json, thiserror, blake3, fancy-regex 0.20.1, walkdir, log; tempfile and Tauri's mock runtime for tests. These are the PRD crates plus tauri-runtime (native resize direction), the WebView2 COM bindings, and test helpers. A Common Controls v6 manifest is embedded in Windows integration-test binaries because the mock runtime links TaskDialogIndirect.

## Boundaries and deviations

- The 748-line Rust contract module is preserved verbatim as required; implementation modules stay below 400 lines.
- Frontend tooling and src/ipc are reassigned to Codex by the chunk instruction. Existing Claude renderer files are not edited. contract/ and vendor/ remain build inputs.
- Resolve/canonicalize the profile before any plugin/window. The Windows mutex and bounded fixed-message named pipe use the canonical profile key, current-user DACLs, and session scope. No stock single-instance plugin is installed.
- Persist window state directly in profile/window-state.json rather than using the window-state plugin's default app-directory storage. This avoids any implicit write outside the resolved profile, keeps normal restore bounds, and excludes hidden/minimized/fullscreen restoration. Window creation runs on a worker so the main event loop can pump WebView2 callbacks.
- Runtime asset grants cover only the validated library, cache, and covers. Library validation conservatively rejects recursive reparse entries; M7 can refine this if linked subdirectories are required. The default library directory remains lazy.
- Settings repair stays in memory until the next change (contract/settings.md section 3); migrations/downgrade normalization write immediately after a versioned backup. Atomic writing preserves unknown ordinary settings and canonical known-key order. No settings_* commands ship in this chunk.
- Original plain placeholder icon only; final artwork/installer belongs to M9.3. Caption overlays/Snap Layouts remain M0.6, with window_set_caption_rects returning NOT_IMPLEMENTED as authorized.
- A minimatch >=11.0.5 override fixes the transitive development-tool advisory; npm install reports zero vulnerabilities.

## Verification and environment

npm install, frontend production build, npm run check (68 Vitest tests, including 14 IPC tests; 46 Rust tests), cargo build, and an unbundled Tauri release build pass. All runs set E_READER_PROFILE_DIR under .test-profile; Rust cases use explicit ereader-test-* temporary directories. The native asset-scope test denies settings.json and library.db.

The restricted shell cannot use its normal global npm cache or Cargo Schannel credentials. Verification uses a repo-local npm cache and ignored temporary CARGO_HOME with a localhost transport relay to the official HTTPS crate/index endpoints. Cargo verifies normal registry checksums and Cargo.lock retains official crates.io source IDs. No relay/configuration is required by the scaffold on a normal development machine.

Native launch reaches WebView2 creation with the correct isolated UDF, then GPU child processes fail with STATUS_ACCESS_DENIED (0xC0000022) in this restricted runner. A test-only software-rendering attempt fails the same way. The visual dark-window smoke is not counted as passed. Diagnostics stay in ignored .test-profile folders; launched app processes are stopped before handoff.

## Question for Dany_PM

The chunk asks for repair-on-load write-back, while contract/settings.md section 3.5 forbids persisting repairs at startup. This implementation follows the contract's delayed write rule. Confirm that this is intended; no contract files were changed.
