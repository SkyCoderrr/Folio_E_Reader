# Folio

A lean, keyboard-first e-book reader for Windows, built for long reading sessions on wide screens. It reads EPUB and TXT, including Chinese books in UTF-8 or GBK.

## Features

- Smooth scroll or paged reading, in a single column (default) or an optional two-page spread
- Typography controls: fonts (Sitka Text, Microsoft YaHei and others), size, spacing and width, plus light, sepia and dark reading themes
- Table of contents that remembers which chapters you've read and where you left off
- Optional progress readout (percentage and/or chapter) that stays visible while the chrome is hidden
- Remembers your position in every book, with bookmarks and reading stats
- Frameless window with auto-hiding chrome, Snap Layouts, and true fullscreen (F11)
- Boss key (Ctrl+Alt+B, rebindable) and tray icon
- Local library: imported books are copied into `Documents\E_Reader Library`

## Keyboard

| Key | Action |
| --- | --- |
| ↑ / ↓, PgUp / PgDn, Space | Scroll or turn page |
| Home / End | Start / end of chapter |
| Ctrl+Home / Ctrl+End | Start / end of book |
| F11 | Fullscreen |
| Esc | Close panel or exit fullscreen |
| Ctrl+Alt+B | Boss key (hide/show) |

## Tech stack

[Tauri v2](https://tauri.app) (Rust) with React, TypeScript and Vite. Rendering uses [foliate-js](https://github.com/johnfactotum/foliate-js), and data is stored in SQLite. The frontend and backend share a versioned contract in `contract/`.

## Build

Requirements: Windows 10/11, Node.js 20+, Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```powershell
git clone --recurse-submodules https://github.com/SkyCoderrr/Folio_E_Reader.git
cd Folio_E_Reader
npm install
npm run check        # lint, types, Vitest and Rust tests
npm run build:test   # release build using an isolated test profile
```

To run with a throwaway profile, so your real library and settings are never touched:

```powershell
$env:E_READER_PROFILE_DIR="$PWD\.test-profile\manual"
.\src-tauri\target\release\e-reader.exe
```

See [docs/INSTALL.md](docs/INSTALL.md) for the installer, and [docs/PRD.md](docs/PRD.md) for the product spec.

## Project layout

```
src/         React UI (reader, library, settings)
src-tauri/   Rust backend (window, library, import, SQLite)
contract/    Shared frontend/backend contract
docs/        PRD, user stories, decisions (ADRs)
tests/       Fixtures
vendor/      foliate-js (git submodule)
```

## License

[MIT](LICENSE)