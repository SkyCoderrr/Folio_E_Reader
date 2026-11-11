# Demo 1 (end of M1) - status 2026-11-09

Branch `feature/v1-foundation` (not merged; main is empty until the owner approves).

## How to run
- Build: `npm install` then `npm run build:test` -> `src-tauri\target\release\e-reader.exe`.
- Run safely with a throwaway profile (PowerShell):
  `$env:E_READER_PROFILE_DIR="$PWD\.test-profile\manual"; .\src-tauri\target\release\e-reader.exe`
  Without the variable the app uses the real profile (`%APPDATA%\com.dany.ereader`).
- Dev mode: `npm run dev:test` (uses `.test-profile\dev`).
- Checks: `npm run check` (eslint, tsc, Vitest, cargo fmt/clippy/test).
- Automated screenshots (isolated `.test-profile\demo`, WebView2 remote debugging on port 9333):
  `node scripts/demo-run.mjs`, then `node scripts/demo-run2.mjs --keep-profile`, `node scripts/demo-run-cjk.mjs`.
- Snap Layouts hit-test check (does not move the mouse): start the exe with a test profile, then
  `powershell -File scripts\check-snap-hittest.ps1 -ProcessId <pid>`.

## What Demo 1 shows
Start screen -> "Open Book" (temporary dev entry; the library is M3) -> continuous single-column scroll
(Scroll + One page, the default) with the Dark preset, PgDn with overlap lines, arrow-key smooth scroll,
Home/End and Ctrl+Home/End, Ctrl+= / Ctrl+- / Ctrl+0, F11, and reopen at the saved position.

## Verified by Dany_PM (isolated profile)
| Check | Result |
| --- | --- |
| Open EPUB (Pride and Prejudice, Alice) | OK - 4 section iframes mounted, text renders |
| Single column default | OK (screenshots 02-05) |
| PgDn keeps overlap lines | OK (07 -> 08: bottom lines repeat at top) |
| Reopen restores position | OK - restored within ~half a line (03 vs 04) |
| Ctrl+End -> book end | OK (06) |
| rAF rate while holding ArrowDown | ~240 fps (display-limited, no stalls seen) |
| Chinese EPUB (Microsoft YaHei, CJK punctuation rules) | OK (07, 08) |
| WM_NCHITTEST over custom caption buttons | min=HTMINBUTTON, max=HTMAXBUTTON, close=HTCLOSE, title=HTCLIENT (100% DPI) |

## Not yet verified / needs the owner
- Hovering the maximize button with the real mouse to see the Snap Layouts flyout (hit-test is correct; flyout itself is a human check), and 150/200% DPI.
- Two-page mode, library, TXT import: later milestones (M0.5/M6, M3, M4).
