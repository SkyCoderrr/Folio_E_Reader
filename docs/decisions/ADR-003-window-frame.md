# ADR-003 — native child hit-test frame (M0.6 Spike C)

Date: 2026-11-09  
Owner: Dany_PM; Rust implementation: Codex  
Status: **Provisional. Implemented and compiled; human Windows 11 hover/visual acceptance pending.**  
Baseline: PRD §6.8 / §14.4, IPC contract 0.2.0. This ADR does not promote or amend the contract.

Owner update (t11u/t12u, 2026-11-10): the Snap Layouts **hover check is not important and is not a blocker**. The remaining Windows visual/hit-test checks retain their recorded status; this decision does not mark the hover flyout verified. References below to the acceptance matrix as a gate exclude the hover-only check.

## Decision and mechanism

Use the PM-selected Rust-owned child HWND mechanism, implemented with `windows` 0.62.
Three small, non-activating `WS_CHILD` windows sit above WebView2 at the HTML caption
button rectangles. Each returns `HTMINBUTTON`, `HTMAXBUTTON`, or `HTCLOSE` from
`WM_NCHITTEST`. No Chromium HWND class names, keyboard synthesis, undocumented messages,
undocumented DWM APIs, or third-party caption plugin are used.

The child class has a null background brush. `WM_PAINT` only validates the update
region; `WM_ERASEBKGND` and `WM_NCPAINT` do not draw. The children are ordinary,
non-layered windows, without input-transparent styles. This is the no-paint candidate:
whether WebView2 content and changing hover backgrounds remain visible underneath
must still be checked on the desktop. A compile/test pass cannot establish compositor behavior.

`WM_NCMOUSEMOVE` is observed by the top-level `DefWindowProcW` for native hover
processing; the parent also answers caption hit tests. Child mouse tracking forwards
hover and pressed state through `window://caption-state`. Down/up are consumed by
Rust. A captured press released over the same button posts exactly one normal
`WM_SYSCOMMAND` to the top-level HWND: minimize, maximize/restore, or close. Close
therefore reaches the existing prevented Tauri `CloseRequested`,
`app://close-requested`, and bounded flush/quit lifecycle. Release outside/capture
loss cancels activation. The frontend must never turn caption-state into a command.
Keyboard/accessibility activation still uses the existing IPC commands.

The parent uses documented `SetWindowSubclass`/`RemoveWindowSubclass` on its own UI
thread. It removes `WS_CAPTION`, and guards `WM_STYLECHANGING` so Tao cannot restore
the native caption on maximize/restore/fullscreen/DPI changes. It retains the sizing,
minimize/maximize and system-menu styles outside fullscreen. Native non-client painting
is suppressed; `WM_NCACTIVATE` uses the documented no-repaint form. Tauri/Tao retain
their `WM_NCCALCSIZE` implementation, maximized work-area/taskbar adjustment and
`.shadow(true)`. `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` requests Windows 11
rounding. No window regions or per-pixel alpha are applied to the top-level window.
Shadow and corner appearance still require visual acceptance. Windows intentionally
does not round maximized/snapped windows.

## Geometry and resizing

WebView zoom remains fixed at 1. `window_set_caption_rects` receives unzoomed viewport
CSS px. Rust reads the WebView2 controller's physical bounds (including its parent
client offset), scales the CSS boundaries once using `GetDpiForWindow / 96`, and
rounds shared boundaries identically. Screen coordinates are sign-extended from
`LPARAM` and mapped with `ScreenToClient`; negative monitor origins are supported.
Finite coordinates, positive dimensions, viewport containment, non-overlap and
non-collapsing physical rectangles are checked. Invalid geometry disables old caption
targets and returns `INVALID_ARGUMENT`; native failures return `WINDOW_OP_FAILED`.

Four additional no-paint child strips cover all client edges, independently of
caption visibility. Their width is `ceil(6 * dpi / 96)` physical px (6/9/12 at
100/150/200%). The strips resolve all eight resize directions, give corners priority,
set standard resize cursors and forward native non-client down to the parent to enter
the OS sizing loop. Resize takes priority over caption buttons in the outer strip.
Strips are disabled while maximized, minimized, hidden, or fullscreen. Native outer
frame sizing remains available through Tao. Reader chrome hiding only removes caption
targets, leaving resize strips intact. The UI does **not** need invisible resize zones.
`window_start_resize` remains a native resize-loop entry point for callers, and does
nothing while maximized/fullscreen.

Drag regions continue to use contract `window_start_drag` (native OS move loop and
Aero Snap). On primary-button mousedown, `detail === 2` calls
`window_toggle_maximize`; other primary presses call `window_start_drag`. The dev page
demonstrates this. Production TitleBar/chrome rendering is owned by Claude Code.

## Lifetime and invalidation

All HWND and WebView2 COM work stays on the window thread. Registry lookups clone an
`Rc` before dispatching messages; no allocation pointer or borrowed map entry is kept
across reentrant Win32 calls. Child windows are parent-owned; the subclass/registry
are removed on parent `WM_NCDESTROY`.

An atomic epoch invalidates already queued native geometry on null, reload start,
fullscreen transitions, hide, resize and DPI change. Hit testing checks the epoch
as well as document/fullscreen state, so old targets stop working before a queued
hide operation executes. Capture loss, cancellation, deactivation, hide and destruction
reset hover/press. Native-titlebar mode installs no overlay. A fresh geometry report
is required after reload, resize/DPI, fullscreen exit, or showing the window.

The frontend must serialize reports, discard obsolete pending geometry and send null
when hidden/unmounted. The dev page serializes calls and drops geometry from disposed
effects. The epoch protects work already admitted to Rust; the current contract has no
document/layout generation token with which Rust could identify an obsolete non-null
request first submitted by JavaScript *after* a later transition. UI queue discipline
is therefore required, as specified by the contract. If Rust must reject such requests
independently, PM should add a generation token in a later contract revision.

## Verified in this session

- Windows/MSVC compilation and Clippy with `--all-targets -- -D warnings` passed.
- `npm run check` passed: ESLint, TypeScript, Vitest (109 tests at that snapshot),
  rustfmt, Clippy and Cargo tests (60 total).
- Added **14 Rust tests**: 13 geometry tests cover 96/144/192 DPI, fractional DPI,
  shared boundaries, signed origin offsets, all eight resize directions, half-open
  hit bounds, invalid scales, non-finite/negative/zero/out-of-bounds/overlapping/
  collapsed rectangles and overflow; one epoch test covers stale work and fullscreen.
- `npm run dev:test` built the executable and selected the isolated
  `<repo>/.test-profile/dev` profile. Startup logs reached asset-scope setup but did
  not reach `Main window created` during the smoke attempt; the run was stopped.
  **No actual HWND hit test, button click, compositor output or Snap flyout was verified.**
- All runs used the profile wrapper or explicitly set `E_READER_PROFILE_DIR` under
  `<repo>/.test-profile/`. No production profile/library was opened.

## Human acceptance gate

Run `npm run dev:test`, open devtools and set `location.hash = '#caption-test'`, then
reload if necessary (the small App switch is selected when App renders). The probe is
DEV-only, with three plain 46 × 40 CSS px buttons, a drag area, state text, caption
visibility toggle and fullscreen controls. The production TitleBar is not used here.

Record the Windows build, WebView2 runtime version, actual monitor DPI and results:

| Test (PRD §14.4) | 100% | 150% | 200% |
| --- | --- | --- | --- |
| Real maximize hover opens Snap Layouts; selecting a zone snaps this window | Pending | Pending | Pending |
| Minimize, maximize/restore, close activate once; release outside cancels | Pending | Pending | Pending |
| Hover/press state reaches page; no black/blank/stale child-window pixels | Pending | Pending | Pending |
| No duplicate native buttons on hover, press, focus, maximize/restore | Pending | Pending | Pending |
| All four edges/four corners resize with correct cursor and ≥6 CSS px reach | Pending | Pending | Pending |
| Native drag, edge/corner/top Aero Snap, Win+arrows, double-click maximize | Pending | Pending | Pending |
| Native shadow and rounded restored corners; taskbar respected maximized | Pending | Pending | Pending |
| Hidden captions leave no hit targets; edges still resize | Pending | Pending | Pending |
| Fullscreen, exit, reload, minimize/restore, hide/show clear stale state | Pending | Pending | Pending |
| Restart with native title-bar setting: no overlay/custom duplication | Pending | Pending | Pending |

Also move between monitors of different DPI (including a monitor with negative screen
coordinates) while normal and maximized. Verify fresh rectangles, correct cursor/hit
alignment, hover flyout anchoring and no leftover child pixels. Test quick
show/hide/fullscreen transitions while a geometry call is in flight. The production
reader's top-56px reveal within 100ms and menu pinning remain the frontend integration
gate; the dev page tests explicit visibility only.

**Do not promote this mechanism to verified/stable until the above is recorded.**
If the no-paint child does not remain visually transparent or Windows does not target
the top-level window from its hover flyout, revise this candidate and repeat the matrix.

## Documented references

- [Microsoft Snap Layout requirements](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)
- [Microsoft custom frame and non-client behavior](https://learn.microsoft.com/en-us/windows/win32/dwm/customframe)
- [Microsoft WM_NCMOUSEMOVE and signed screen coordinates](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-ncmousemove)
- [Microsoft WM_STYLECHANGING](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-stylechanging)
- [Microsoft Windows 11 corner preferences and limitations](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-rounded-corners)
