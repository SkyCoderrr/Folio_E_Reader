# Folio: Product Requirements Document

> 2026-11-11 - Owner decision t25u: the app is now **Folio**. The original requirements below retain their historical naming. Bundle/profile identifiers, `E_READER_*` variables, Cargo names, database/settings filenames and the default `Documents\E_Reader Library` path remain unchanged. Renaming the default library folder is a later owner decision.

Status: **v1.0 - Approved 2026-11-09** · Owner: Dany_PM · Author: Claude Code · Date: 2026-11-09
Stories: [USER_STORIES.md](USER_STORIES.md) (IDs such as `LM-02` refer to stories there).
v2 applies [PRD_ADDENDUM.md](PRD_ADDENDUM.md) and the owner's decisions of 2026-11-09: single column is the default, Snap Layouts is required, a Process section is added, and extras are moved to §17 Optional ideas. v1.0 applies the owner's final answers to the open questions (§16, "Resolved owner decisions") and records the owner's approval of 2026-11-09.

---

## 1. Overview and goals

E_Reader is a personal, local-only e-book reader for a Windows PC with wide monitors. Most readers are designed around a phone held upright. E_Reader assumes a landscape screen, a keyboard, and someone who reads by **scrolling** for hours and wants to control every visual detail. EPUB is the main format. TXT (especially Chinese web novels in legacy encodings) is a close second, and CJK typography is first-class.

### Goals (v1)

| # | Goal | Measured by |
| --- | --- | --- |
| G1 | Reading feels calm and immersive: only text on screen while reading. | Chrome auto-hides (RS-01). No permanent UI in the reading area. |
| G2 | Scrolling in one column is the best way to read here. | The default layout is one continuous, centred column (LM-01). Held-arrow scrolling runs at a constant frame rate with no visible steps (KB-02). Two-page layouts exist only as opt-in options (LM-02, LM-04). |
| G3 | Everything visual the owner listed is customizable, with live preview, and saveable as presets. | Every setting in §8 is reachable in the UI. Preview latency < 100 ms (RS-10). |
| G4 | Chinese TXT "just works". | 100% of the encoding test corpus decodes correctly (FMT-04). Chapter split is correct on the 10-book reference set (FMT-07). |
| G5 | Keyboard-complete, with a reliable boss key. | Every reader action has a rebindable shortcut (KB-01, KB-05). Boss key hides in < 100 ms and restores exactly (WIN-01/02). |
| G6 | The window behaves like a native Windows 11 window. | Resize from every edge and corner, edge snapping, and Snap Layouts on the custom maximize button (WIN-07). |
| G7 | A usable build early, then iterate. | Demo 1 (open EPUB → scroll with custom styling → reopen at the same place) at the end of M1 (§13). |

### Success criteria for v1 sign-off
1. The owner reads a full Chinese TXT novel and a full English EPUB in E_Reader without falling back to another reader.
2. All P0 stories pass their acceptance criteria. The performance targets in §11 are met on the owner's PC.

---

## 2. Non-goals (v1)

- Accounts, cloud sync, or any network access (the app makes **no** network requests).
- Highlights and notes, in-book search (P2, see `LATER-*`).
- MOBI, AZW3, PDF, CBZ, fixed-layout EPUB, or DRM (fixed-layout and DRM books show a clear message).
- macOS, Linux, or mobile builds. The stack doesn't prevent them, but v1 is tested on Windows 11 (Windows 10 is not a v1 target, §16 Q9 default).
- A light app UI. The app shell is dark-only (§6.1). Reading themes can be any colour.
- Translucent or glass materials (Liquid Glass, Mica, acrylic) as part of the core design. The reading surface is always a solid colour.
- A store or catalogue, OPDS, or online metadata lookup.
- Multi-user or multi-profile support for the owner. (The profile override in §12.5 exists only to isolate tests.)
- Anything in §17 Optional ideas, unless the owner promotes it.

---

## 3. Target user

**One user: the owner.** Single-user assumptions are allowed everywhere: no permissions model, no onboarding flow, and defaults tuned to their habits.

| Trait | Design consequence |
| --- | --- |
| Reads on a wide or ultrawide landscape Windows monitor | One centred column with line length capped in em. Two-page layouts are available but never the default. Layouts follow window width, not device. |
| Scroll reader, rarely turns pages | Scroll mode is the default. Arrow-key physics get the most polish. PgDn keeps overlap lines. |
| Reads many Chinese books, often TXT in GBK/GB18030/Big5 | Encoding auto-detection, chapter regex, CJK fonts, kinsoku line breaking, 2 em indent. |
| Wants to customize everything visual | Central settings model, presets, rebindable keys, a human-readable settings.json. |
| Values privacy at the desk | Global boss key (`Ctrl+Alt+B`, rebindable); the window vanishes completely, including from the taskbar, while the tray icon stays as the way back. |
| Heavy keyboard user | Every command has a key. Single-key shortcuts in the reader. Tooltips show shortcuts. Visible focus. |
| Likes Apple's design scheme; dislikes clutter | Clean typography, calm spacing, clear hierarchy, soft depth, restrained motion. Lean surfaces with no redundant controls (§6.1). |
| Uses Windows 11 window management | Frameless window that still resizes, snaps, and shows Snap Layouts (§6.8). |

---

## 4. Product principles

1. **The page is the product.** While reading, nothing competes with the text. Chrome overlays and never reflows the text (RS-01). No translucency or decoration in the content layer, and the reading surface is always solid (cf. Apple `going-full-screen.md › Best practices`: "Prioritize content by temporarily hiding toolbars and navigation controls").
2. **Motion only when it is physically meaningful.** Paged-flow turns, mode switches and keyboard-toggled panels are **instant**. Scroll-flow navigation uses a short ease-out glide (owner decision 2026-11-10); reduced motion makes it instant. Motion is kept for continuous scrolling, dragging and surfaces that move from where they physically come from.
3. **Never lose the reader's place.** Every operation that reflows text (font change, resize, mode switch, re-encoding, re-splitting) preserves the first visible line.
4. **Good defaults, and exactly the controls that were asked for.** Ship excellent defaults (Sonner: "Good defaults matter more than options"). §8 is the closed list of v1 settings. Ideas beyond the owner's asks go to §17. Reading-appearance controls live in the in-context Appearance panel. Everything else lives in Settings (Apple `settings.md › Task-specific options`).
5. **Lean surfaces.** No redundant controls. Primary actions are direct (double-click opens a book), and secondary actions live in a `⋯` menu, a right-click menu, or on hover.
6. **Respect the platform.** Use Windows conventions for keys, window controls, resizing, snapping, Snap Layouts, tray, fullscreen and file dialogs. Follow system settings (reduced motion, DPI) instead of duplicating them (Apple `settings.md`: "Respect people's systemwide settings").
7. **Robust over clever.** Prefer documented platform mechanisms with a fallback over OS tricks (no synthesized keystrokes, no undocumented APIs).
8. **Small, modular, contract-first code.** One settings/theme model drives all styling. The Rust backend and the React UI meet only at the documented contract in `contract/` (§12).
9. **Clean licensing.** MIT/BSD/Apache dependencies only. Readest, Koodo and Alexandria are behaviour references, and their code is never copied.

---

## 5. Feature requirements

Each requirement refers to the stories that define its acceptance criteria. Priority follows the stories.

### 5.1 Reading surface and appearance: RS-01…RS-10, UI-02, UI-03
- FR-RS-1 Overlay chrome (top bar, which is also the title bar, and the footer) auto-hides on pointer idle and reappears when the pointer reaches the top or bottom edge. `H` toggles it. (RS-01, WIN-06)
- FR-RS-2 A `ReadingStyle` model (§8.1) covers colours, fonts (separate Latin and CJK families), size, weight, line/letter/paragraph spacing, indent, alignment, margins, max line width, page gap and CJK options. (RS-02…RS-07, FMT-09)
- FR-RS-3 `compileStyle(ReadingStyle) → CSS` is the only path from settings to book CSS. It is injected into every section document and re-injected on change without reloading the section. (RS-10)
- FR-RS-4 Four built-in presets, unlimited custom presets, and a "Modified" state with Update and Revert. (RS-08, RS-09)
- FR-RS-5 The Appearance panel previews every change live on the real page. (RS-10, UI-03)

### 5.2 Layout modes and scrolling: LM-01…LM-07
- FR-LM-0 Layout is two independent choices: **flow** (`scroll` | `paged`) × **pages per view** (`1` | `2`). The default is `scroll` + `1`: one continuous column. Two pages per view is opt-in only. It is never the default, never chosen automatically, and never restored on a fresh profile. One page always holds exactly **one text column**, at any window width, in both scroll and paged flow. (LM-01, LM-03, LM-05)
- FR-LM-1 **Scroll, one page** (default): one continuous vertical column across all sections, with virtualized section mounting. (LM-01)
- FR-LM-2 **Scroll, two pages** (opt-in, "Word multi-page view"): fixed-size pages in rows of two, with the rows stacked vertically and scrolling continuously. (LM-02)
- FR-LM-3 **Paged, one page** and **Paged, two pages** (two is opt-in): instant snap with no animation. When the window is narrower than `layout.minSpreadWidthPx`, two pages falls back to one page automatically. (LM-03, LM-04)
- FR-LM-4 Mode switching and resizing preserve the locator to within 1 line. (LM-05, LM-07)
- FR-LM-5 Paging in scroll flow moves by the viewport minus `scroll.pageOverlapLines` × line height, with a 200 ms ease-out animation; repeat presses extend the prior target. Reduced motion snaps instantly (owner decision 2026-11-10). (LM-06)

### 5.3 Keyboard: KB-01…KB-07
- FR-KB-1 Keymap registry with scopes (`global`, `app`, `library`, `reader`, `reader.autoscroll`, `panel`), the default map in §7, up to 3 bindings per action, stored by `KeyboardEvent.code` plus modifiers. (KB-01, KB-05)
- FR-KB-2 Key events from section iframes are forwarded to the router. IME composition events are ignored. (KB-01)
- FR-KB-3 `SmoothScroller`: requestAnimationFrame-driven, frame-time-based velocity with a start ramp, optional acceleration and release deceleration. It ignores OS auto-repeat and stops on blur. (KB-02)
- FR-KB-4 Navigation keys: page, chapter, book start/end. (KB-03, KB-04)
- FR-KB-5 Fullscreen (`F11`), font size keys and `Ctrl+wheel`, with WebView zoom disabled. (KB-06, KB-07)
- FR-KB-6 Rebinding UI with conflict detection and reserved keys. Every tooltip for an icon button names its shortcut. (KB-05, UI-07)

### 5.4 Boss key and window: WIN-01…WIN-07
- FR-WIN-1 The global shortcut is registered **in Rust**, and hide/show runs natively without a round trip through the webview. JS is told by events so it can pause timers and auto-scroll. (WIN-01, WIN-02)
- FR-WIN-2 Hide = `window.hide()` (the window disappears completely, including from the taskbar and Alt+Tab; the tray icon stays visible). Show = `show()` + `unminimize()` + `set_focus()`. The webview stays alive, so the state is exact. (WIN-02)
- FR-WIN-3 A tray icon (always present, and still visible while the window is boss-hidden, so it is a way to restore the window) with Show/Hide, Library, Settings, Quit. The boss key defaults to `Ctrl+Alt+B` (owner-confirmed), is rebindable, and never defaults to `Ctrl+Alt+Space`. If the boss key fails to register, the user is told at once and in Settings. (WIN-03, WIN-04)
- FR-WIN-4 Window-state persistence and a single instance, with the lock keyed by profile path (§12.5). (WIN-05)
- FR-WIN-5 A frameless custom window that resizes from every edge and corner, snaps to screen edges, shows Windows 11 Snap Layouts when hovering the custom maximize button, and never shows a second set of native caption buttons. The caption buttons are always reachable: always visible in Library and Settings, and revealed by moving the pointer to the top edge in the reader. A native title bar is available as a fallback setting. (WIN-06, WIN-07, §6.8)

### 5.5 Library: LIB-01…LIB-09
- FR-LIB-1 Import by drag and drop (files and folders) and by picker. The pipeline runs in Rust: hash → dedupe → copy into the visible library folder (`library.folder`, §9.1) → metadata → cover thumbnail → DB row → event. (LIB-01…03)
- FR-LIB-2 Grid and list views virtualized with react-virtuoso, sort and search/filter, generated covers. (LIB-04…07)
- FR-LIB-3 Remove with confirmation, deleting the library copy and associated data. (LIB-08)
- FR-LIB-4 Double-click or `Enter` opens a book at its last position. There is no Open button. (LIB-09, UI-07)

### 5.6 Formats: FMT-01, FMT-02, FMT-04…FMT-09
- FR-FMT-1 Reflowable EPUB 2/3 via foliate-js parsing, with images fitted to the column and internal links working. Scripts are disabled and there is no network access. Fixed-layout and DRM books are detected and get a message. (FMT-01)
- FR-FMT-2 Three levels of publisher-style override. (FMT-02)
- FR-FMT-3 TXT decoding in Rust: BOM → strict UTF-8 → `chardetng` → `encoding_rs`. Per-book override. (FMT-04, FMT-05)
- FR-FMT-4 TXT paragraph detection and chapter splitting in Rust (`fancy-regex`), producing cached HTML sections and a manifest. Live regex preview. (FMT-06…FMT-08)
- FR-FMT-5 CJK typography rules in `compileStyle`, with feature detection for `text-spacing-trim` and `text-autospace`. (FMT-09)

### 5.7 Navigation: NAV-01…NAV-05
- FR-NAV-1 Locator model (§9.4), saved on settle, close, hide and quit. (NAV-01)
- FR-NAV-2 Foldable TOC sidebar (Contents | Bookmarks tabs) with current-chapter tracking. (NAV-02, NAV-03, NAV-05)
- FR-NAV-3 Bookmarks with margin marks. (NAV-04)

### 5.8 App UI: UI-01…UI-07
- FR-UI-1 Token-driven dark UI in Apple's general design scheme (§6), base-ui primitives, Sonner toasts, visible focus, follows the system reduced-motion setting. (UI-01, UI-05, UI-06)
- FR-UI-2 An in-app Settings page with a left nav that remembers the last pane. (UI-04)
- FR-UI-3 Lean surfaces and direct manipulation: no redundant controls, secondary actions in `⋯`/right-click/hover, shortcuts in tooltips, a sidebar icon (not a hamburger), validation only after the user acts, and physically correct drag. (UI-07)

### 5.9 Stats and auto-scroll (P1 apart from ST-01): ST-01…ST-05, AS-01…AS-04
- FR-ST-1 Session tracker (aware of activity and idle time) → `sessions` table → per-book and per-day aggregates, speed and time left. ST-01 (progress %) is P0.
- FR-AS-1 `AutoScroller`, built on the same rAF engine as `SmoothScroller`, with speed keys and auto-pause rules.

---

## 6. UX and visual design spec

Sources applied: Apple's general design scheme via the Apple design skill and HIG (`dark-mode.md`, `typography.md`, `color.md`, `sidebars.md`, `settings.md`, `keyboards.md`, `going-full-screen.md`, `scroll-views.md`); Emil Kowalski `emil-design-eng` and `ui-cheatsheet`; `pick-ui-library`. Where Apple and Windows differ, Windows conventions win (§6.10).

### 6.1 Design direction

- **Apple's design scheme in general, not Liquid Glass.** That means clean typography, calm spacing, clear hierarchy, soft depth (elevated surfaces are slightly lighter, with hairline borders and gentle shadows), and restrained motion that obeys physics. Glass, blur and Mica are not part of the core design (Mica behind non-reading surfaces is listed in §17). The reading surface is always a solid colour.
- **Thesis:** *A lamp-lit desk on a wide screen.* The page is the calmest, brightest object. The library, panels and chrome stay dim and quiet until called.
- **Bold colour where it carries meaning.** State is shown with **whole-row and whole-card tints**, not thin accent bars or outlines. Examples: the current TOC chapter row, a selected book card, the active Settings pane, the active preset chip. Generated covers use saturated whole-card colours. The accent is a warm amber (#D9A55B), so the dark UI feels like paper in shadow rather than a neon terminal. Every tint must stay readable in the dark shell and in light reading themes (reader chrome adopts the reading theme, UI-02). Primary text on any tint must be ≥ 7:1, and this is checked by tests.
- **App appearance:** the app shell is **dark-only**. Apple allows "using only a dark appearance" for immersive content (`dark-mode.md › Best practices`: "In rare cases, consider using only a dark appearance… for an app that supports immersive media viewing"). Reading themes (Sepia, Light…) are *content* settings, and reader chrome takes the reading theme's colours (UI-02), so a light page never sits under a black bar.
- **Lean surfaces:** no redundant controls. Double-click or `Enter` opens a book, so there is no Open button. Secondary actions live in a `⋯` menu, a right-click menu, or appear on hover. Icon-only buttons have tooltips that name their shortcut. The sidebar toggle uses a sidebar icon, never a hamburger.
- **Validation only after the user acts.** Fields never show "required" or format errors before the user commits a value (blur, Enter, or a Save click).

### 6.2 UI colour tokens (app shell)

Defined once in `src/ui/tokens.css`. No other file may contain a hex value (lint rule). Contrast ratios are WCAG 2.x, computed from the hex values.

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| `--surface-0` | `#111214` | Window background (library, settings), solid | — |
| `--surface-1` | `#18191C` | Sidebars, cards, rows on hover | — |
| `--surface-2` | `#222327` | Popovers, menus, dialogs (elevated) | — |
| `--border` | `rgb(255 255 255 / 0.08)` | Hairlines, dividers, card edges | non-text |
| `--border-strong` | `rgb(255 255 255 / 0.14)` | Input outlines, focusable edges | non-text |
| `--text-1` | `#ECEAE6` | Primary text | 15.6:1 on s0 · 14.6:1 on s1 · 13.1:1 on s2 |
| `--text-2` | `#A3A09A` | Secondary text (author, metadata) | 7.2:1 on s0 · 6.7:1 on s1 · 6.0:1 on s2 |
| `--text-3` | `#807D77` | Tertiary text (hints, placeholders, disabled) | 4.6:1 on s0 |
| `--accent` | `#D9A55B` | Focus ring, primary button fill, bookmark mark | 8.5:1 on s0 · 7.1:1 on s2 |
| `--accent-tint` | `rgb(217 165 91 / 0.18)` | Whole-row / whole-card "current" and "selected" state | `--text-1` on tint over s0 ≈ 11:1 |
| `--accent-ink` | `#1A1408` | Text on solid accent fills | 8.3:1 on accent |
| `--danger` | `#E5484D` | Destructive button fill (text `#FFFFFF`) | — |
| `--caption-close` | `#C42B1C` | Title-bar close hover (Windows standard) | — |

Rules (Apple `color.md › Best practices`): one colour means one thing. Accent means "you are here / selected / primary / focus". Danger is used only for destruction. State is never shown by colour alone: tinted rows also get weight 600, and selected cards also get a check or ring for keyboard focus. Elevation in dark mode comes from *lighter surfaces plus a hairline border* (`dark-mode.md`, base vs. elevated). Popovers get at most `0 8px 24px rgb(0 0 0 / 0.4)`.

### 6.3 Built-in reading presets

Apple `dark-mode.md › Dark Mode colors`: "strive for a contrast ratio of 7:1, especially in small text". Night is a deliberate low-contrast exception that still stays ≥ 4.5:1.

| Preset | Background | Text | Accent (links) | Text contrast | Accent contrast | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Dark** (default) | `#17181B` | `#D6D1C7` | `#D9A55B` | 11.7:1 | 8.0:1 | Softened warm white, not `#FFF`, to cut glare. |
| **Sepia** | `#F3EAD7` | `#3A2F23` | `#8A4B14` | 10.9:1 | 5.7:1 | |
| **Light** | `#FAF9F6` | `#1E1E1C` | `#7A4A0C` | 15.9:1 | 7.1:1 | Off-white paper. |
| **Night (low contrast)** | `#0D0D0E` | `#8C867C` | `#A07C48` | 5.4:1 | 5.1:1 | For dark rooms. |

Shared preset defaults: Latin font `Sitka Text` (ships with Windows and is designed for screen reading), CJK font `Microsoft YaHei` (Windows built-ins only; no fonts are bundled, owner decision 2026-11-09), fallback `serif`, 20 px, weight 400, line height 1.75, letter spacing 0, paragraph spacing 0.5 em, indent = publisher (EPUB) / 2 em (TXT), justify, max line width 36 em (≈ 36 CJK characters or ≈ 70 Latin characters), margins 48/40 px, selection = accent at 32% alpha.

### 6.4 UI typography

UI text uses the system font. Personality lives in the *content* font.

- Family: `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif`. Display sizes (≥ 20 px) use `"Segoe UI Variable Display"`.
- Ramp (adapted from the Windows Fluent ramp, with a minimum of 12 px):

| Style | Size / line height | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| Caption | 12 / 16 | 400 | 0 | Footer, metadata, timestamps |
| Body | 14 / 20 | 400 | 0 | Default UI text, list rows, controls |
| Body strong | 14 / 20 | 600 | 0 | Current TOC item, field labels |
| Subtitle | 18 / 24 | 600 | -0.01em | Panel and section headers |
| Title | 24 / 32 | 600 | -0.015em | Page titles (Library, Settings panes) |
| Display | 32 / 40 | 600 | -0.02em | Empty-state headline only |

- No Light or Thin weights in the UI (Apple `typography.md`: "avoid light font weights").
- `font-variant-numeric: tabular-nums` on every number that changes: progress %, timers, slider values.
- Pluralize with `Intl.PluralRules` ("1 book", "3 books"). Dates are relative for up to 7 days, then absolute.
- UI copy uses title case for buttons and menu items (Windows convention) and sentence case for descriptions. Labels say what happens: "Add Books", "Remove", "Save as Preset".

### 6.5 Spacing, shape, iconography

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48. Panels use 16 px padding. Settings groups have 24 px gaps.
- Radii: 4 px (chips, small controls, covers), 6 px (buttons, inputs), 8 px (popovers, menus, cards), 12 px (dialogs, floating side panels).
- Control sizes: buttons and inputs are 32 px high. Icon buttons are 32 × 32 (at least 28 × 28 in dense rows). Title-bar caption buttons are 46 × 40.
- Icons: **Lucide** (ISC licence), 16 px in rows and 20 px in toolbars, 1.5 px stroke, `currentColor`. The sidebar toggle is `PanelLeft` / `PanelLeftClose` (never `Menu`/hamburger). Overflow is `Ellipsis` (`⋯`). Every icon-only button has an `aria-label` and a tooltip that includes its shortcut ("Contents  T").

### 6.6 Motion spec

Easing tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Never use `ease-in`. Never use `transition: all`. Surface animations use only `transform` and `opacity`; continuous scroll-flow motion integrates `scrollTop` per frame (ADR-001). Use transitions rather than keyframes for anything that can be interrupted. Every motion must be physically plausible: things move from where they are to where they go, and nothing animates for decoration.

| Interaction | Trigger | Motion | Rationale |
| --- | --- | --- | --- |
| Page turn (paged) | Key or click | **None**, instant | Owner requirement. Emil: never animate keyboard actions. |
| PgDn/PgUp, Space/Shift+Space in scroll flow | Key | 200 ms ease-out; reduced motion snaps | Owner decision 2026-11-10. |
| Held arrow scroll / auto-scroll | Key hold | Continuous physics (KB-02) | Direct manipulation. |
| Layout switch, font-size keys | Key | None | Frequent and keyboard-driven. |
| Chrome auto-hide / edge reveal | Pointer idle or pointer at edge | Opacity: hide 150 ms `ease`, show 100 ms | Prevents a jarring pop. Never moves text. |
| Chrome toggle `H`, TOC `T`, Appearance `A` | Key | None | Keyboard. |
| TOC / Appearance panel | Pointer click | Slides in from its own edge: 200 ms `translateX(∓8px→0)` + opacity, `--ease-out`. Exit 150 ms. | The panel comes from where it lives. |
| Menus, popovers | Pointer | 150 ms `scale(0.97→1)` + opacity, `transform-origin` at the trigger | Grows out of what was clicked. |
| Dialogs | Any | 200 ms `scale(0.97→1)` + opacity, centred | Modals stay centred. |
| Tooltips | Hover | 500 ms delay, 125 ms fade. Adjacent tooltips open instantly. | |
| Buttons | `:active` | `scale(0.97)`, 120 ms `--ease-out` | Pressing feels physical. |
| Hover states | Pointer | Background colour, 120 ms `ease`, inside `@media (hover:hover) and (pointer:fine)` | |
| Drag of any item | Press-and-hold 250 ms anywhere on the item (no handle) | The item follows the pointer 1:1. Neighbours slide aside (200 ms `--ease-out`). **No insertion line**, because the moving neighbours already show the slot. On drop, the item glides **from where it was released** to its slot (200 ms `--ease-out`). On cancel, it glides back. | Direct manipulation. Applies to any drag added later. v1 has no reorderable lists. |
| File-drop overlay | Drag enter | Opacity 150 ms | |
| Toasts | System | Sonner defaults | |

Reduced motion (`prefers-reduced-motion: reduce`, set by Windows "Animation effects"): all transforms are removed and opacity fades are capped at 150 ms. Held-key scrolling stays continuous because it is user-driven, but the start ramp and release deceleration drop to 0 ms. There is no in-app motion toggle (Apple `settings.md`: avoid redundant versions of system settings).

### 6.7 Screens

**Library** (the start view, and reachable with `Ctrl+W` from the reader):

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ E_Reader                                                         ─   ☐   ✕     │ 40px title bar, solid --surface-0, always visible
├────────────────────────────────────────────────────────────────────────────────┤
│ Library     [⌕ Search title or author   Ctrl+F]   [Grid|List]  [Sort ▾]  [+ Add Books] │
│ All · Reading · Unread · Finished        EPUB · TXT                            │
│                                                                                │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                 │
│ │cover │ │cover │ │ 三体 │ │cover │ │cover │ │cover │ │cover │   150px covers  │
│ │ 2:3  │ │      │ │(gen.)│ │      │ │      │ │      │ │      │   ⋯ on hover    │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                 │
│ Title…   Title…   三体      Title…   …                                         │
│ Author   Author   刘慈欣    Author                                             │
│ ▬▬▬──42% New      ▬▬▬▬▬ ✓   ▬───12%                                            │
└────────────────────────────────────────────────────────────────────────────────┘
```
- Opening: double-click or `Enter`. The default sort (Last read) puts the current book first. There is no Open or Continue button.
- Selection: a selected card gets a whole-card `--accent-tint`. Hovering a card tints it `--surface-1` and reveals its `⋯` button.
- `⋯` and right-click menu on a book: Text Encoding ▸ (TXT), Chapter Detection… (TXT), Remove….
- Empty state: Display "Your library is empty", Body "Drop EPUB or TXT files anywhere in this window, or", and an [Add Books] primary button.

**Reader, scroll flow, one page (the default), chrome revealed** (chrome is hidden most of the time):

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ [◧] ← Library  红楼梦 — 第二十三回                Aa   Layout ▾   ⋯   ─  ☐  ✕ │ top bar = title bar, 40px, theme-tinted, auto-hides
│                                                                                │
│               |<---------- one text column, max 36em, centred ---------->|     │
│                 (Chinese paragraph text, 2em first-line indent ...)            │
│                                      ———               <- chapter separator   │
│                              (next chapter heading)                            │
│                 (text continues, no page break ...)                            │
│ 第二十三回 · 31.4%                                       12 min left in chapter │ footer, caption 12px, auto-hides
└────────────────────────────────────────────────────────────────────────────────┘
```
- `[◧]` is the sidebar toggle (`PanelLeft`, tooltip "Contents  T").
- `Layout ▾` holds two segmented choices: **Scroll | Paged** (`M`) and **One page | Two pages** (`D`). One page is selected by default.
- `⋯` holds every reader command with its shortcut (the Windows stand-in for "every command in the menu bar", §6.10).
- The native scrollbar is hidden in scroll flow because the virtualized height is only an estimate. The footer shows the position.

**Reader, scroll flow, two pages** (opt-in, LM-02):

```
┌────────────────────────────────────────────────────────────────────────────────┐
│        ┌──────────────────────────┐   ┌──────────────────────────┐            │
│        │ page 1                   │   │ page 2                   │  row 1     │
│        │ (one column)             │   │ (one column)             │            │
│        └──────────────────────────┘   └──────────────────────────┘            │
│        ┌──────────────────────────┐   ┌──────────────────────────┐  ↓ rows    │
│        │ page 3                   │   │ page 4                   │  scroll    │
└────────────────────────────────────────────────────────────────────────────────┘
```
- Page edges: 1 px border at 6% text colour. Page background = theme background. The desk around the pages = background mixed 4% toward black (dark themes) or toward the text colour (light themes).

**Appearance panel** (right side, 360 px, `A`). Sections in order: Presets (chips, with the active one tinted; "Save as Preset…"; "Modified · Update · Revert"), Colours (background, text, accent/link, selection; each a swatch plus a hex field), Fonts (Latin and CJK pickers showing names in their own typeface; weight), Size & Spacing (size, line height, letter spacing, paragraph spacing, indent), Layout (alignment, max line width, margins, page gap), CJK (punctuation trim, autospace). Every slider has a numeric field and a reset dot that appears only when the value differs from the preset.

**TOC sidebar** (left, 300 px, foldable; Apple `sidebars.md`): two tabs (Contents | Bookmarks), at most 2 levels expanded with deeper levels behind disclosure chevrons, hidden and shown with the sidebar icon or `T` ("Consider letting people hide the sidebar"), and no critical actions at the bottom. The current chapter row gets a whole-row `--accent-tint`, weight 600 and `--text-1`. Other entries use `--text-2`.

**Settings** (`Ctrl+,`; full in-app page): a left nav (General · Reading · Scrolling · Keyboard · Library · TXT & CJK · Stats · About) where the active pane gets a whole-row tint. It reopens on the last pane (Apple `settings.md`: "Restore the most recently viewed pane"). Settings holds infrequently changed options. Reading appearance lives in the in-context panel.

### 6.8 Window frame and title bar

The window is frameless (`decorations: false`) with the Windows 11 native shadow and rounded corners. It must behave exactly like a native window:

| Requirement | Detail |
| --- | --- |
| Resize | From all 4 edges and all 4 corners, with standard resize cursors, in every view, including while reader chrome is hidden. The hit zone is ≥ 6 px at 100% scaling and scales with DPI. |
| Move and snap | Dragging the title bar moves the window with native Aero Snap (edges, corners, top-to-maximize). Win+arrow keys work. Double-clicking the title bar maximizes or restores it. |
| Snap Layouts | Hovering the custom maximize button shows the Windows 11 Snap Layouts flyout, just as in a native window. Clicking still maximizes or restores. |
| No duplicate buttons | Windows must never paint its own caption buttons behind or over the custom ones: not on hover, focus change, maximize, restore, or DPI change. |
| Reachability | The caption buttons sit at the top right (minimize, maximize/restore, close; 46 × 40; close hover `--caption-close`). In Library and Settings the title bar is always visible. In the reader the title bar is the top bar and hides with the chrome. Moving the pointer into the top 56 px reveals it within 100 ms, and it stays while the pointer is over it or one of its menus is open. Reaching Snap Layouts is therefore one motion: move to the top edge and hover maximize. `H` pins the chrome. |
| Fullscreen | In fullscreen (`F11`), the top-edge reveal shows the top bar with an "Exit full screen" button instead of the caption buttons. |
| Fallback | `window.titleBar = "native"` (restart required) uses the standard Windows title bar, which never auto-hides. It is a safety valve, not the default. |

Implementation constraint (principle 7): the maximize-button region must report `HTMAXBUTTON` to Windows non-client hit-testing, which is Microsoft's documented mechanism for Snap Layouts in custom title bars. Candidates, decided in spike M0.6 and recorded in `ADR-003-window-frame.md`: (a) WebView2's non-client region support, if the shipping runtime exposes caption-button regions; (b) a small native child window owned by Rust, placed over the caption-button area, that answers `WM_NCHITTEST` and forwards hover and press state to the UI. Synthesized keystrokes and undocumented APIs are not allowed.

### 6.9 Accessibility floor
- Text contrast: UI primary ≥ 7:1, secondary ≥ 4.5:1 (§6.2), including on tints. Built-in reading presets meet §6.3.
- Full keyboard operation. Every control is reachable by Tab, and `:focus-visible` shows a 2 px `--accent` ring with a 2 px offset. Focus is never trapped except in modal dialogs, which close with `Esc`.
- Icon-only controls have accessible names. The TOC uses `role="tree"`. Dialogs and menus use base-ui's ARIA behaviour.
- Honour Windows display scaling (100–200%) and reduced motion. Test at 150% and 200% DPI.

### 6.10 Apple → Windows adaptations

| Apple guidance (file › section) | E_Reader on Windows |
| --- | --- |
| Command is the main modifier (`keyboards.md › Custom keyboard shortcuts`) | **Ctrl** is primary, Shift secondary, Alt sparingly, the Win key never. Shown in Windows order: `Ctrl+Alt+Shift+Key`. |
| Command-Comma opens settings (`settings.md`, `keyboards.md`) | `Ctrl+,` opens Settings. |
| Control-Command-F enters full screen (`going-full-screen.md › Desktop`) | `F11` toggles fullscreen. `Esc` exits. |
| Every command is reachable from the menu bar | There is no menu bar (normal for modern Windows apps). Every command is reachable from a toolbar button, the `⋯` menu or a context menu, and tooltips and menus show the shortcut. |
| Settings window with a toolbar of panes | In-app Settings page with a left nav (Windows 11 Settings pattern) that remembers the last pane. |
| Follow the system Dark Mode; no app appearance switch (`dark-mode.md`) | The shell is dark-only (immersive-content exception). Reading presets are content settings. |
| Desktop translucency (`dark-mode.md › Desktop`) | Not used in core UI. All surfaces are solid. Mica is a §17 optional idea and would never apply to content. |
| Page-by-page scrolling with an overlap unit (`scroll-views.md › Best practices`) | PgDn = viewport − `pageOverlapLines` × line height (LM-06). |
| Support default scrolling gestures (`scroll-views.md`) | The wheel, touchpad and scrollbar keep native Chromium behaviour. |
| Don't nest same-axis scroll views (`scroll-views.md`) | One vertical scroller per reader. Section iframes are auto-height with `scrolling="no"`. |
| Hide toolbars during content focus, restore by moving to the top (`going-full-screen.md`) | Chrome auto-hides with edge reveal (RS-01). The revealed top bar includes the caption buttons (§6.8). |
| Let people reveal the Dock in full screen | The Win key and taskbar stay reachable. We never block them. |
| Window controls | Windows caption buttons on the right, 46 × 40, red close hover, with Snap Layouts on maximize (§6.8). |

---

## 7. Keyboard shortcut map (defaults; all rebindable)

Single-key shortcuts are active only in the `reader` scope when focus is not in a text field. Scope priority, highest first: `panel` > `reader.autoscroll` > `reader` > `app` > `global`. Tooltips and the `⋯` menu always show the current binding.

### Reader
| Action ID | Default binding(s) | Notes |
| --- | --- | --- |
| `scroll.down` / `scroll.up` | `↓` / `↑` | Smooth while held (KB-02). In paged flow: next/prev page. |
| `page.next` | `PgDn`, `Space`, `→` | Viewport − overlap (scroll flow); next page or spread (paged). |
| `page.prev` | `PgUp`, `Shift+Space`, `←` | |
| `chapter.start` / `chapter.end` | `Home` / `End` | Start/end of the current chapter (owner decision 2026-11-09). |
| `book.start` / `book.end` | `Ctrl+Home` / `Ctrl+End` | Start/end of the book. |
| `toc.toggle` | `T` | Folds or unfolds the sidebar on Contents. |
| `bookmarks.show` | `Ctrl+B` | Opens the sidebar on Bookmarks. |
| `bookmark.toggle` | `Ctrl+D` | |
| `appearance.toggle` | `A` | |
| `chrome.toggle` | `H` | |
| `fullscreen.toggle` | `F11` | |
| `font.increase` / `font.decrease` / `font.reset` | `Ctrl+=` (also `Ctrl+NumpadAdd`) / `Ctrl+-` / `Ctrl+0` | `Ctrl+wheel` is also handled. |
| `layout.toggleFlow` | `M` | Scroll ↔ Paged. Keeps the pages-per-view choice. |
| `layout.togglePages` | `D` | One page ↔ Two pages (opt-in). Keeps the flow choice. |
| `autoscroll.toggle` | `S` | P1 |
| `book.close` | `Ctrl+W` | Back to the library. |
| `dismiss` | `Esc` | Closes the top panel, then exits fullscreen. |

### Reader while auto-scroll is active (`reader.autoscroll`, P1)
| Action ID | Default binding(s) | Notes |
| --- | --- | --- |
| `autoscroll.pause` | `Space` | Overrides `page.next` only while auto-scroll is running. |
| `autoscroll.faster` / `autoscroll.slower` | `=` / `-` | ±`autoscroll.step` % |

### Library
| Action | Binding |
| --- | --- |
| `library.import` | `Ctrl+O` |
| `library.search` | `Ctrl+F` |
| `library.viewGrid` / `library.viewList` | `Ctrl+1` / `Ctrl+2` |
| `library.open` | `Enter` (or double-click) |
| `library.remove` | `Delete` |
| `library.selectAll` | `Ctrl+A` |
| Navigation | Arrow keys move the selection; `Home`/`End` go to first/last |

### App and global
| Action | Binding | Scope |
| --- | --- | --- |
| `settings.open` | `Ctrl+,` | app |
| `app.quit` | `Ctrl+Q` (`Alt+F4` is native) | app |
| `boss.toggle` | `Ctrl+Alt+B` | **global (OS-level)**. Owner-confirmed default, rebindable. Never `Ctrl+Alt+Space` (taken on the owner's PC). |

Reserved, cannot be bound: `Alt+F4`, `Alt+Tab`, `Ctrl+Alt+Del`, any `Win+…`, and `F12` in debug builds. A boss key must include a modifier, or be `Pause`, `ScrollLock` or `F13`–`F24`. If registration fails because another app owns the chord, the app reports the conflict (WIN-03) and keeps running.

---

## 8. Settings model

Settings live in `settings.json` (§9.2) as a typed, versioned object. The authoritative schema is `contract/settings.schema.json` (§12.2). This section is its source. **Scope:** `P` = part of a ReadingStyle preset · `G` = global · `B` = can be overridden per book (stored in the DB). Colours are `#RRGGBB` or `#RRGGBBAA`. Ranges are inclusive. Out-of-range values are clamped on load and logged. This is the closed list for v1 (R12).

### 8.1 ReadingStyle (preset fields)

| Key | Type | Default (Dark) | Range / options | Scope |
| --- | --- | --- | --- | --- |
| `colors.background` | color | `#17181B` | any | P |
| `colors.text` | color | `#D6D1C7` | any | P |
| `colors.accent` | color | `#D9A55B` | any. Used for links, the current-chapter tint and bookmark marks | P |
| `colors.selection` | color+alpha | `#D9A55B52` | any | P |
| `font.latin` | string (family) | `"Sitka Text"` | installed families | P |
| `font.cjk` | string (family) | `"Microsoft YaHei"` | installed families | P |
| `font.fallback` | enum | `serif` | `serif`, `sans-serif` | P |
| `font.size` | int (px) | `20` | 10–72, step 1 | P |
| `font.weight` | int | `400` | 100–900, step 10 (static fonts snap to the nearest face) | P |
| `text.lineHeight` | number (unitless) | `1.75` | 1.0–3.0, step 0.05 | P |
| `text.letterSpacing` | number (em) | `0` | −0.05–0.30, step 0.005 | P |
| `text.paragraphSpacing` | number (em) | `0.5` | 0–3, step 0.1 | P |
| `text.indentMode` | enum | `publisher` | `publisher`, `force`, `none` (TXT treats `publisher` as `force`) | P |
| `text.indentSize` | number (em) | `2` | 0–4, step 0.5 | P |
| `text.align` | enum | `justify` | `publisher`, `left`, `justify`. Justified Latin text gets automatic hyphenation. | P |
| `layout.marginX` | int (px) | `48` | 0–400 | P |
| `layout.marginY` | int (px) | `40` | 0–200 | P |
| `layout.maxLineWidthEm` | number (em) | `36` | 0 (= fill) or 15–120 | P |
| `layout.pageGap` | int (px) | `48` | 0–200 (two-page layouts only) | P |
| `cjk.punctuationTrim` | bool | `true` | — | P |
| `cjk.autospace` | bool | `true` | — | P |

Preset container: `{ id, name, builtIn: bool, style: ReadingStyle, updatedAt }`. The global `activePresetId` defaults to `"builtin.dark"`.

### 8.2 Reader and layout

| Key | Type | Default | Range / options | Scope |
| --- | --- | --- | --- | --- |
| `reader.flow` | enum | `scroll` | `scroll`, `paged` | G |
| `reader.pagesPerView` | int | `1` | `1`, `2`. 2 is opt-in only; the app never sets it on its own. | G |
| `layout.minSpreadWidthPx` | int | `1000` | 600–3000. Below this width, 2 pages falls back to 1. | G |
| `epub.styleOverride` | enum | `balanced` | `minimal`, `balanced`, `full` (§16 Q5) | G |
| `chrome.autoHideDelayMs` | int | `2000` | 500–10000 | G |
| `cursor.autoHideDelayMs` | int | `1500` | 0 (never) or 500–10000 | G |

Two-page page geometry (owner decision 2026-11-09): each page is exactly one screen (viewport) tall, so `PgDn` moves one row of pages. There are no fixed paper proportions in v1.

### 8.3 Scrolling and auto-scroll

| Key | Type | Default | Range / options | Scope |
| --- | --- | --- | --- | --- |
| `scroll.arrowSpeed` | number (px/s) | `720` | 60–4000 | G |
| `scroll.startRampMs` | int | `80` | 0–400 | G |
| `scroll.acceleration` | bool | `true` | — | G |
| `scroll.accelMax` | number (×) | `2.5` | 1–6 | G |
| `scroll.accelRampMs` | int | `800` | 100–4000 | G |
| `scroll.stopDecelMs` | int | `100` | 0–500 | G |
| `scroll.tapLines` | int | `3` | 1–10 | G |
| `scroll.pageOverlapLines` | int | `2` | 0–10 | G |
| `autoscroll.speed` | number (px/s) | `40` | 5–400 | G |
| `autoscroll.step` | int (%) | `10` | 1–50 | G |
| `autoscroll.pauseOnBlur` | bool | `true` | — | G |

### 8.4 TXT

| Key | Type | Default | Range / options | Scope |
| --- | --- | --- | --- | --- |
| `txt.encoding` | enum | `auto` | `auto`, `utf-8`, `utf-16le`, `utf-16be`, `gb18030`, `big5`, `shift_jis`, `euc-kr`, `windows-1252` | B only |
| `txt.chapterRegex` | string (fancy-regex syntax, multiline mode) | see below | valid regex, ≤ 1000 chars | G, B |
| `txt.headingMaxChars` | int | `40` | 4–100 | G, B |
| `txt.fallbackChunkChars` | int | `10000` | 2000–100000 | G |
| `txt.paragraphMode` | enum | `auto` | `auto`, `line`, `blank` | G, B |

Default `txt.chapterRegex`:
```
^[ \t　]*(?:第[0-9０-９零〇一二三四五六七八九十百千万两]+[章回节節卷集部篇](?:[ \t　:：·.、-].*)?|卷[0-9０-９一二三四五六七八九十百千]+.*|(?:Chapter|CHAPTER)\s+(?:\d+|[IVXLCDM]+)\b.*|序章|序言|楔子|引子|尾声|尾聲|后记|後記|番外.*)[ \t　]*$
```

### 8.5 Library, window, system, stats

| Key | Type | Default | Range / options | Scope |
| --- | --- | --- | --- | --- |
| `library.storageMode` | enum | `copy` | `copy` only in v1 (no "reference in place" mode) | G |
| `library.folder` | path | `Documents\E_Reader Library` (Windows Documents known folder); `<profile>\library` when `E_READER_PROFILE_DIR` is set | any writable folder; changeable in Settings › Library | G |
| `library.view` | enum | `grid` | `grid`, `list` | G |
| `library.sort` | enum | `lastRead` | `lastRead`, `added`, `title`, `author`, `progress` | G |
| `library.sortDir` | enum | `desc` | `asc`, `desc` | G |
| `library.filter` | enum | `all` | `all`, `reading`, `unread`, `finished` | G |
| `window.titleBar` | enum | `custom` | `custom`, `native` (fallback; restart required) | G |
| `bossKey.enabled` | bool | `true` | — | G |
| `bossKey.shortcut` | chord string | `"Ctrl+Alt+B"` | must include a modifier, or be Pause/ScrollLock/F13–F24 | G |
| `stats.enabled` | bool | `true` | — | G |
| `stats.idleTimeoutSec` | int | `180` | 30–900 | G |
| `keybindings` | `Record<ActionId, Chord[]>` | §7 defaults (only diffs stored) | ≤ 3 chords per action | G |

---

## 9. Data model and storage

### 9.1 Profile and locations

**Profile root** = the value of the environment variable `E_READER_PROFILE_DIR` if it is set, otherwise Tauri `appDataDir` (`%APPDATA%\com.dany.ereader\`). The root is resolved once in Rust at startup and logged. **Every** persisted file lives under it. No code may write elsewhere (§12.5).

```
<profile>\
  settings.json                  user settings and presets (human-readable, atomic writes)
  window-state.json              size, position, maximized state, monitor (window-state plugin, path pinned here)
  library.db                     SQLite (WAL mode)
  library\covers\<id>.jpg        300 px wide JPEG q85 thumbnails (2× the 150 px grid)
  cache\txt\<id>\<paramsHash>\   decoded TXT: manifest.json + s0001.html … (rebuildable, safe to delete)
  logs\                          rotating logs (tauri-plugin-log), 5 × 1 MB
```
**Library folder (owner decision 2026-11-09).** Imported books are COPIED into a visible library folder, not hidden in the profile:

```
<library.folder>\                 default: Documents\E_Reader Library
  <id>.epub|.txt                  copied book files; <id> = first 32 hex chars of BLAKE3(file)
```
- The default is `Documents\E_Reader Library`, resolved through the Windows Documents known folder (so a redirected or OneDrive Documents folder works). The path can be changed in Settings › Library (`library.folder`). `books.file_rel_path` is relative to it.
- The DB, settings, progress, covers, cache and logs stay in the app profile. Only the book files live in the library folder.
- When `E_READER_PROFILE_DIR` is set (all test runs), `library.folder` defaults to `<profile>\library`, so tests never touch the real Documents folder.
- There is no "reference in place" mode in v1 (see §17).

### 9.2 settings.json
```ts
interface SettingsFile {
  version: 1;                         // bumped with migrations in src/state/settings/migrations.ts
  activePresetId: string;
  presets: Preset[];                  // custom presets only; built-ins live in code
  reader: { flow: 'scroll'|'paged'; pagesPerView: 1|2 };
  layout: { minSpreadWidthPx: number };
  scroll: { arrowSpeed: number; /* … §8.3 */ };
  autoscroll: { speed: number; step: number; pauseOnBlur: boolean };
  txt: { chapterRegex: string; headingMaxChars: number; fallbackChunkChars: number; paragraphMode: 'auto'|'line'|'blank' };
  library: { storageMode: 'copy'; folder?: string; view: 'grid'|'list'; sort: LibrarySort; sortDir: 'asc'|'desc'; filter: LibraryFilter };
  window: { titleBar: 'custom'|'native' };
  bossKey: { enabled: boolean; shortcut: string };
  stats: { enabled: boolean; idleTimeoutSec: number };
  chrome: { autoHideDelayMs: number };
  cursor: { autoHideDelayMs: number };
  epub: { styleOverride: 'minimal'|'balanced'|'full' };
  keybindings: Partial<Record<ActionId, string[]>>;   // diffs from defaults only
  ui: { settingsLastPane: string; tocOpen: boolean };
}
```
Only non-default values need to be present. Defaults merge in on load, so hand-editing is safe. Unknown keys are preserved. Writes go to `settings.json.tmp`, then an atomic rename.

### 9.3 SQLite schema (v1)
```sql
CREATE TABLE books (
  id              TEXT PRIMARY KEY,               -- BLAKE3 content hash prefix
  format          TEXT NOT NULL CHECK (format IN ('epub','txt')),
  title           TEXT NOT NULL,
  author          TEXT,
  language        TEXT,                           -- BCP 47, e.g. zh-Hans
  file_name       TEXT NOT NULL,                  -- original name, for display
  file_rel_path   TEXT NOT NULL,                  -- relative to the library folder
  file_size       INTEGER NOT NULL,
  cover_rel_path  TEXT,
  total_chars     INTEGER,                        -- filled lazily
  progress        REAL NOT NULL DEFAULT 0,        -- 0..1, denormalised for library sort
  added_at        INTEGER NOT NULL,               -- unix ms
  last_opened_at  INTEGER,
  finished_at     INTEGER,
  meta_json       TEXT NOT NULL DEFAULT '{}'      -- publisher, description, identifiers, series
);
CREATE INDEX books_last_opened ON books(last_opened_at DESC);

CREATE TABLE book_prefs (                         -- TXT per-book overrides (FMT-05, FMT-08)
  book_id             TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  txt_encoding        TEXT,          -- null = auto
  txt_detected_enc    TEXT,
  txt_chapter_regex   TEXT,
  txt_heading_max     INTEGER,
  txt_paragraph_mode  TEXT
);

CREATE TABLE positions (
  book_id       TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  locator_json  TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE bookmarks (
  id            INTEGER PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator_json  TEXT NOT NULL,
  progress      REAL NOT NULL,
  chapter_title TEXT,
  snippet       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX bookmarks_book ON bookmarks(book_id, progress);

CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY,
  book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  local_day       TEXT NOT NULL,     -- 'YYYY-MM-DD' local; sessions crossing midnight are split
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL,
  active_ms       INTEGER NOT NULL,
  chars_advanced  INTEGER NOT NULL,  -- excludes jumps > 1 viewport
  start_progress  REAL NOT NULL,
  end_progress    REAL NOT NULL
);
CREATE INDEX sessions_day ON sessions(local_day);
CREATE INDEX sessions_book ON sessions(book_id);

PRAGMA user_version = 1;             -- migrations in src-tauri/src/db/migrations.rs
```

### 9.4 Locator
```ts
interface Locator {
  sectionIndex: number;        // spine index (EPUB) or generated section index (TXT)
  cfi?: string;                // EPUB CFI of the first visible text position (foliate-js epubcfi)
  charOffset: number;          // characters from section start to the first visible character
  globalCharOffset?: number;   // TXT only: from start of decoded text; survives re-split / re-encode
  progress: number;            // 0..1 over the whole book (by characters)
  snippet: string;             // ~32 chars at the anchor, for fuzzy re-anchoring if the CFI fails
}
```
Resolution order on restore: `cfi` → (`sectionIndex`, `charOffset`) → `globalCharOffset` (TXT) → `progress`. "First visible character" = the result of `caretPositionFromPoint` at (content left + 1 em, viewport top + 0.5 × line height), so that it lands on a real line and not in a margin.

---

## 10. Architecture and tech stack

### 10.1 Stack decision: **confirmed, with one deliberate divergence**

| Layer | Choice | Why / alternatives considered |
| --- | --- | --- |
| Shell | **Tauri v2** (Rust) | WebView2 ships with Windows 11 and is evergreen Chromium, so CSS support matches current Chrome. Installer ~5–10 MB vs ~150 MB for Electron. Rust suits encoding detection, hashing, SQLite, the global shortcut and Win32 window-frame work. Official plugins cover global shortcut, tray, dialog, window state and single instance. *Electron* would pin Chromium but at 15× the size with no feature we need. *WinUI 3/.NET* would still need WebView2 for EPUB HTML. |
| UI | **React 19 + TypeScript (strict) + Vite** | Coding agents are most fluent here. The UI is small. |
| Book engine | **foliate-js** (MIT), git submodule pinned to a commit in `vendor/foliate-js` | Used for EPUB parsing (`makeBook`), CFI (`epubcfi.js`), TOC/progress helpers, and its **paginator for paged flow** (`flow=paginated`, no animation, column count forced per §10.4). |
| **Divergence** | **Own `FlowRenderer` and `PageGridRenderer`** | As far as we know (to be confirmed in spike M0.4), foliate-js's `scrolled` flow renders **one section at a time**, so scrolling past a chapter end swaps sections instead of flowing on. For a scroll-first reader that is the core experience, so we write a small continuous renderer (~500 lines) on top of foliate-js's book and section API. foliate-js has no Word-style 2-up vertical page grid, so that is ours too. Fallback if the spike fails: epub.js's `continuous` manager (BSD) for scroll flow only. |
| State | **zustand** | Tiny, no providers. |
| UI primitives | **base-ui** (dialog, popover, menu, select, slider, switch, tabs, tooltip, toggle group) | Accessible, unstyled, origin-aware popovers (`--transform-origin`). |
| Toasts | **Sonner** | Import results, undo actions, boss-key conflict notice. |
| Virtualization | **react-virtuoso** (`VirtuosoGrid`, `TableVirtuoso`) | Library at 1,000+ books. |
| Charts | **recharts** | Stats page (P1). |
| Styling | **CSS Modules + CSS custom properties** (`tokens.css`), **clsx** | No Tailwind build layer. Tokens in one file. Reading CSS is generated separately. |
| Icons | **lucide-react** | |
| Not used | motion/Framer Motion (CSS transitions suffice), dnd kit (no reorderable lists in v1; file drop uses Tauri events), cmdk | Keep the dependency count low. **Leva** is allowed as a **dev-only** panel for tuning scroll physics. |
| Rust crates | `rusqlite` (bundled), `encoding_rs`, `chardetng`, `fancy-regex`, `blake3`, `zip`, `quick-xml`, `image` (jpeg/png/webp), `fontdb`, `serde`/`serde_json`, `thiserror`, `walkdir`, `windows` (Win32 hit-testing for §6.8, if ADR-003 needs it) | |
| Tauri plugins | `global-shortcut`, `dialog`, `window-state`, `single-instance`, `log`; tray via the core `tray-icon` feature | No `fs` or `http` plugin, which keeps the attack surface minimal. |

### 10.2 High-level structure
```
E_Reader/
├─ docs/                          PRD, stories, decisions/ADR-*.md            (Dany_PM)
├─ contract/                      IPC + settings contract (§12.2)             (Dany_PM)
├─ .agent-logs/conversation.md    agent exchange log (§12.3)
├─ vendor/foliate-js/             git submodule (pinned), never edited in place
├─ src/                           React + TS                                 (Claude Code)
│  ├─ app/                        App.tsx, router (library | reader | settings | stats), providers
│  ├─ ui/                         tokens.css, base-ui wrappers (Button, Slider, NumberField, Switch,
│  │                              Select, Segmented, Dialog, Popover, Menu, Tooltip, Tabs, ColorField,
│  │                              FontPicker, TitleBar, CaptionButtons)
│  ├─ state/                      settingsStore, libraryStore, readerStore (zustand); settings/migrations.ts
│  ├─ ipc/                        commands.ts, events.ts: typed wrappers that mirror contract/ exactly
│  ├─ engine/
│  │  ├─ book/                    BookSource.ts, epubSource.ts (foliate makeBook), txtSource.ts
│  │  ├─ style/                   readingStyle.ts (types, defaults, built-in presets), compileStyle.ts
│  │  ├─ locator.ts               get/resolve Locator, CFI bridging
│  │  ├─ renderers/               Renderer.ts, FlowRenderer.ts, PageGridRenderer.ts, PaginatorRenderer.ts
│  │  └─ input/                   keymap.ts (defaults, types), keyRouter.ts, smoothScroller.ts, autoScroller.ts
│  └─ features/                   library/, reader/ (ReaderView, Chrome, Footer), toc/, bookmarks/,
│                                 appearance/, settings/, stats/
└─ src-tauri/src/                 Rust                                       (Codex)
   ├─ lib.rs                      builder, plugins, command registration
   ├─ profile.rs                  E_READER_PROFILE_DIR resolution, path helpers
   ├─ commands/                   library.rs, books.rs, txt.rs, positions.rs, bookmarks.rs,
   │                              stats.rs, settings.rs, fonts.rs
   ├─ db/                         mod.rs, migrations.rs, repo.rs
   ├─ import/                     pipeline.rs, epub_meta.rs (zip + quick-xml OPF), covers.rs, txt_title.rs
   ├─ txt/                        decode.rs, split.rs, paragraphs.rs, html.rs, cache.rs
   └─ system/                     boss_key.rs, tray.rs, window.rs, window_frame.rs (Snap Layouts hit-testing)
```

### 10.3 Key interfaces
```ts
// engine/book/BookSource.ts: a superset of foliate-js's "book" interface, so the paginator accepts it directly
interface BookSource {
  format: 'epub' | 'txt';
  metadata: { title: string; author?: string; language?: string };
  toc: TocItem[];
  sections: Array<{ id: string; linear: boolean; size: number;   // size in bytes/chars for progress
                    load(): Promise<string>;                     // URL (blob/asset) for the iframe
                    createDocument(): Promise<Document>; unload(): void }>;
  resolveHref(href: string): { index: number; anchor?(doc: Document): Element | Range };
  splitTOCHref(href: string): [string, string?];
  destroy(): void;
}

// engine/renderers/Renderer.ts
interface Renderer {
  mount(el: HTMLElement, book: BookSource, css: CompiledStyle, at?: Locator): Promise<void>;
  setStyle(css: CompiledStyle): Promise<void>;     // must preserve the current locator
  goTo(target: Locator | { href: string }): Promise<void>;
  getLocator(): Locator;
  scrollBy(px: number): void;                      // Flow, PageGrid; no-op for Paginator
  page(dir: 1 | -1): void;                         // viewport minus overlap, or page snap
  resize(): void;                                  // ResizeObserver-driven, locator preserved
  on(ev: 'relocate' | 'section' | 'load', cb: (e: unknown) => void): () => void;
  destroy(): void;
}
```
Renderer choice: `scroll`+1 → FlowRenderer · `scroll`+2 → PageGridRenderer · `paged`+1/2 → PaginatorRenderer.

### 10.4 Rendering pipeline
1. `BookSource` yields sections as documents. EPUB comes from foliate-js. TXT comes from Rust-generated `sNNNN.html` files loaded through the Tauri asset protocol.
2. Each section is rendered in an `<iframe sandbox="allow-same-origin" scrolling="no">` (**no `allow-scripts`**). The CSP blocks network access. The iframe isolates publisher CSS from app CSS.
3. `compileStyle` output is injected as the last `<style id="er-style">` in each section's `<head>`. Override strength follows `epub.styleOverride`. Theme colours are also set on the host (desk background, chrome tint). The compiled CSS forces a single text column inside each page (`column-count: 1` / `columns: auto` overrides on publisher CSS).
4. **FlowRenderer** (the default): a single vertical scroll container holding a list of section slots, with one centred column. The mounted window is the current section ±1 (up to ±2 while scrolling quickly), so at most 5 are mounted. Unmounted slots are spacers with estimated height: `chars × measured px-per-char` for the current style, or the remembered measured height. Each iframe's height follows `ResizeObserver` on its `documentElement`. When a section above the viewport changes height, `scrollTop` is corrected by the delta (native CSS scroll anchoring first, with manual correction as backup).
5. **PageGridRenderer** (scroll + two pages, opt-in): candidate A is CSS Multicol Level 2 (`column-height` + `column-wrap: wrap`) inside each section iframe, which wraps columns into rows natively (2 per row, rows stacking vertically). This needs a WebView2 version that ships these properties and is verified in spike M0.5. Candidate B, the more robust option, is a fixed-height multicol strip that yields N horizontal pages, displayed through virtualized "row windows". Each row is a clipped view (width = 2 pages + gap) onto a clone of the section's layout, offset by `−row × 2 × (pageWidth + gap)`, with only visible rows ±2 cloned. Each column is one page. ADR-002 records the choice.
6. **PaginatorRenderer:** foliate-js `<foliate-view>` / paginator with `flow="paginated"` and animation disabled. One page: `max-column-count = 1`, enforced at every width, so an ultrawide window never shows two columns. Two pages: `max-column-count = 2`, falling back to 1 below `layout.minSpreadWidthPx`.
7. **Keys:** each iframe document gets a `keydown`/`keyup` listener that re-dispatches to `keyRouter`. Wheel events with Ctrl are intercepted for font size.

### 10.5 Rust command surface (IPC), initial draft for contract v0
The authoritative definitions (names, argument and return types, events, errors) live in `contract/` (§12.2). This table seeds contract v0 and is not updated afterwards.

| Command | Purpose |
| --- | --- |
| `library_import(paths)` | Streams `import://item` and `import://done` events. |
| `library_list()`, `library_remove(ids)` | Library reads and removal. |
| `book_open(id)` | `{ format, assetUrl \| txtManifest, prefs, locator }` |
| `txt_prepare(id, {encoding?, regex?, headingMax?, paragraphMode?})` | Decode, split, cache → manifest `{ detectedEncoding, lang, sections:[{title, file, startChar, chars}] }` |
| `txt_preview_split(id, regex, headingMax)` | `{ count, first20: string[] }` for the live regex editor |
| `position_save(id, locator)`, `bookmarks_*`, `stats_session_save(session)`, `stats_query(range)` | Persistence. |
| `settings_load()`, `settings_save(json)` | Atomic write under the profile. |
| `fonts_list()` | `[{ family, localizedFamilies, cjk: bool, weights: number[] }]` via `fontdb`; `cjk` = has U+4E00, U+6C34, U+3002 |
| `boss_set_shortcut(chord)` | `Ok`, or an error explaining why registration failed |
| `window_set_caption_rects(rects)` | UI reports caption-button rectangles (DIPs) for hit-testing (§6.8), if ADR-003 needs it |
| Events from Rust | `boss://hidden`, `boss://shown`, `boss://register-failed`, `tray://open-library`, `tray://open-settings` |

Every command error uses one shape: `{ code: string, message: string, details?: object }`. `code` is a stable `SCREAMING_SNAKE` identifier (for example `TXT_DECODE_FAILED`, `SHORTCUT_IN_USE`). The UI maps codes to user-facing copy. `message` is for logs.

**CSP** (tauri.conf.json): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' blob:; img-src 'self' asset: http://asset.localhost blob: data:; font-src 'self' asset: http://asset.localhost blob: data:; frame-src blob: asset: http://asset.localhost; connect-src ipc: http://ipc.localhost asset: http://asset.localhost blob:`. The asset protocol scope is limited to the library folder (`library.folder`, updated at runtime when it changes) and the profile's `cache\` and `library\covers\`. WebView zoom hotkeys are disabled.

### 10.6 Boss key flow
The `global-shortcut` callback runs on a Rust thread. If the window is visible: save window state in memory → `window.hide()` → emit `boss://hidden` (JS pauses auto-scroll and the session timer, stops held-key scrolling, and saves the locator). If it is hidden: `window.show()` → `unminimize()` → `set_focus()` → emit `boss://shown`. Because the process received the hotkey, Windows lets it take the foreground. Fullscreen state is kept by the window itself. If registration fails at startup or on rebinding, Rust emits `boss://register-failed { chord, code }` and the UI shows WIN-03's notice.

---

## 11. Performance targets

Reference machine: the owner's PC. "Mid-range" means a 4-core CPU from 2020 or later, 16 GB RAM, an SSD and a 1440p/2160p display, release build.

| Metric | Target |
| --- | --- |
| Cold start → library interactive | < 1.0 s (< 1.5 s with 2,000 books) |
| Open 5 MB EPUB → first text visible at saved position | < 800 ms |
| Open 10 MB GB18030 TXT (first time: decode + split + cache) | < 1.2 s; cached reopen < 500 ms |
| Rust decode + split of 10 MB TXT | < 400 ms |
| Arrow-key scroll | First movement ≤ 1 frame after keydown; ≥ 99% of frames on time at 60/120/144 Hz; no long task > 50 ms during scroll |
| Paged page turn | Next page painted ≤ 50 ms after keydown |
| PgDn in scroll flow | Starts within 1 frame; completes within 250 ms (instant with reduced motion) |
| Style change (live preview) | Repaint < 100 ms; < 150 ms for a 50,000-char section; locator drift ≤ 1 line |
| Layout mode switch | < 500 ms; drift ≤ 1 line |
| Boss key | Hidden < 100 ms; restored < 200 ms |
| Title-bar reveal at top edge | Visible ≤ 100 ms after the pointer enters the zone |
| Library search filter (2,000 books) | < 50 ms per keystroke |
| Import | ≥ 10 EPUBs/s (hash + copy + metadata + cover) on SSD |
| Memory | < 350 MB working set with a 10 MB TXT open in scroll flow |
| Installer size | < 15 MB (no bundled fonts) |

A dev-only perf overlay (`Ctrl+Shift+P` in debug builds) shows FPS, long tasks, mounted sections and the last locator restore time.

---

## 12. Process and coordination

### 12.1 Roles and ownership

| Who | Owns | Does not |
| --- | --- | --- |
| **Owner** | Final approval of the PRD, merges to `main`, pushes, promoting §17 ideas | — |
| **Dany_PM** | PRD, stories, `contract/`, task assignment, scope decisions | Write app code |
| **Codex** | Rust/Tauri backend: `src-tauri/**`, `Cargo.toml`, `tauri.conf.json`, Rust tests, packaging. Implements every contract command and event. | Edit `src/**` or `contract/**` |
| **Claude Code** | React UI: `src/**`, CSS, frontend tests, `package.json`, Vite/ESLint/Vitest config. Calls the backend only through `src/ipc/`, which mirrors the contract. | Edit `src-tauri/**` or `contract/**` |

### 12.2 Contract (`contract/`), owned by Dany_PM
- Files: `README.md` (contract version and changelog), `commands.md` (each Tauri command: name, args with types, return type, error codes, story IDs, a JSON example), `events.md` (event names and payload types), `errors.md` (the error shape in §10.5 and the code list), `settings.schema.json` (JSON Schema derived from §8).
- Both agents build against the contract and nothing else. Neither side relies on undocumented behaviour of the other.
- **Changes:** an agent that needs a change proposes it in the log. Dany_PM edits `contract/`, bumps the version and records it in the changelog. Then both sides adapt. Agents never edit `contract/` themselves.
- Claude Code develops against IPC mocks built from the contract's JSON examples (`@tauri-apps/api/mocks`), so the UI never waits for the backend. Codex adds contract tests: every documented example round-trips through the Rust serde types.
- A feature that needs a new command starts only after that command is in the contract.

### 12.3 Logging
Every exchange between agents, and between an agent and Dany_PM, is appended to `.agent-logs/conversation.md` as `## YYYY-MM-DD HH:MM Sender -> Receiver`, followed by the message. The log is append-only. It records task handoffs, contract change requests, blockers, decisions and the status note at the end of every chunk.

### 12.4 Git
- **The owner does not make the first commit on `main`.** Work starts on the branch `feature/v1-foundation`, created before the first commit: `git init`, then `git checkout -b feature/v1-foundation`, then the first commit (M0.1). `main` receives nothing until the owner approves a merge.
- Later work happens on feature branches named `feature/<name>` (for example `feature/m1-3-flow-renderer`), one chunk per branch. A chunk split into R and F parts uses two branches (`…-rust`, `…-ui`).
- **Never** commit to `main`, push, merge or reset without the owner's explicit approval.
- Commit messages cite chunk and story IDs.

### 12.5 Protecting real user data
- `E_READER_PROFILE_DIR` overrides the whole profile root (§9.1): settings, DB, cache, logs, window state, and the default library folder (`<profile>\library` instead of `Documents\E_Reader Library`).
- Every automated test and every app instance launched by an agent sets it to a fresh temporary folder (for example `%TEMP%\e_reader_test\<run-id>`). The scripts `npm run dev:test` and the e2e runners set it automatically. `cargo test` uses temporary directories.
- Agents never launch the app against the owner's real profile and never read or modify `%APPDATA%\com.dany.ereader\` or the owner's `Documents\E_Reader Library`.
- The single-instance lock is keyed by the resolved profile path, so a test instance never hands off to (or focuses) the owner's running app.
- Test profiles ship with `bossKey.enabled = false`, so tests never take the owner's boss key.
- The resolved profile path is logged at startup.

### 12.6 Definition of done and resumable state
A chunk is done when its acceptance criteria pass, `npm run check` is green, all work is committed on its feature branch with no stray or uncommitted files, and the log has a status note covering what is done, what is not, the contract version used, and how to resume. At each milestone the demo script is run, a milestone summary goes into the log, and the owner decides about merging. Work is never left half-migrated across a milestone boundary.

### 12.7 Scope discipline
Build only what this PRD and the stories require. Ideas go into the log as suggestions. Dany_PM may add them to §17, and only the owner promotes them into v1.

---

## 13. Milestones and implementable chunks

Rules for coding agents (in addition to §12):
- Read this PRD, the cited stories and the relevant `contract/` files first.
- Each chunk ships with tests (§14) and passes `npm run check` (eslint, tsc, vitest, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`).
- **Never copy code from Readest, Koodo Reader, Alexandria or any (A)GPL source.** Never edit `vendor/` in place; adapters live in `src/engine`.
- No dependencies beyond §10.1 without stating them in the log for Dany_PM.
- Keep modules small (aim for < 400 lines per file). Record any deviation from this PRD in `docs/decisions/ADR-NNN-*.md`.
- **Lanes:** **C** = Dany_PM (contract), **R** = Codex (Rust), **F** = Claude Code (React). R and F chunks with satisfied dependencies run in parallel.
- Size: S ≈ < 0.5 day, M ≈ 1 day, L ≈ 2–3 days of agent work plus review.

### M0 · Foundation, contract and spikes
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M0.0 | Contract v0 in `contract/`: commands, events, error shape and settings schema for M1–M3 | Both agents acknowledge v0 in the log | — | C | S |
| M0.1 | `git init`, then `git checkout -b feature/v1-foundation` BEFORE the first commit (nothing is committed to `main`; the owner approves any merge). Scaffold Tauri v2 + Vite React TS; rustfmt/clippy/cargo test; CSP; zoom hotkeys off; frameless dark 1280×800 window; `profile.rs` (`E_READER_PROFILE_DIR`; library folder default per §9.1); single instance keyed by profile; profile path logged | `npm run tauri dev` with a temp profile opens a dark window; a Rust test proves every path resolves under the override | — | R | M |
| M0.2 | Frontend tooling: TS strict, ESLint/Prettier, Vitest, `npm run check`, `npm run dev:test` (temp profile), IPC mock harness fed from contract examples | `npm run check` passes | M0.0, M0.1 | F | S |
| M0.3 | Add the foliate-js submodule (pinned) + `vendor/README.md` (commit, licence) + `foliate.d.ts` typings; a dev route opens a picked EPUB and logs spine and TOC | Spine and TOC log correctly for 3 sample books | M0.2 | F | S |
| M0.4 | **Spike A:** FlowRenderer prototype with 3 sections stacked as auto-height sandboxed iframes; anchoring on prepend; fps measurement; confirm foliate-js scrolled-mode behaviour | `ADR-001-flow-renderer.md` with measurements and a go/no-go | M0.3 | F | M |
| M0.5 | **Spike B:** PageGrid candidate A (`column-wrap`) feature check in WebView2, else a candidate B prototype | `ADR-002-page-grid.md` with the choice and fps numbers | M0.3 | F | M |
| M0.6 | **Spike C:** window frame per §6.8: edge/corner resize, Aero Snap, Snap Layouts on a custom HTML maximize button, no duplicate native caption buttons, at 100/150/200% DPI | `ADR-003-window-frame.md` with the chosen mechanism; a demo title bar passes the §14.4 window script | M0.1 | R (minimal F test page by Claude Code) | M |

### M1 · First readable build → **Demo 1**
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M1.1 | `BookSource` + `epubSource` (foliate `makeBook`) | Unit-tested against 3 sample EPUBs (sections, TOC, hrefs) | M0.3 | F | S |
| M1.2 | `readingStyle.ts` (types, defaults, 4 built-in presets) + `compileStyle` (CJK rules, override levels, forced single column) | Snapshot tests per preset and override level; contrast values asserted | M0.2 | F | M |
| M1.3 | FlowRenderer v1 per ADR-001: one centred column, virtualized slots, height estimation, anchoring, style injection, iframe key forwarding, chapter separator | LM-01 passes on the sample books | M0.4, M1.1, M1.2 | F | L |
| M1.4 | `keyRouter` (scopes, IME guard) + `smoothScroller` (physics, fake-clock tests) + animated PgUp/PgDn overlap + Home/End/Ctrl+Home/End | KB-02, KB-03, KB-04, LM-06 pass | M1.3 | F | M |
| M1.5a | Temporary persistence: `kv_get`/`kv_set` commands per contract, under the profile | Rust tests green | M0.1, M0.0 | R | S |
| M1.5b | `locator.ts` (first visible character → CFI + charOffset; resolve) using `kv_*` | Reopen restores within 1 line across 20 random positions (automated) | M1.3, M1.5a | F | M |
| M1.6 | Minimal reader shell (temporary dev "open file" entry, removed in M3): Dark preset, `Ctrl+=/-/0`, `F11`, `Esc` | **Demo 1:** open an EPUB, scroll smoothly in one column, PgDn with overlap, close, reopen at the same place | M1.4, M1.5b | F | S |

### M2 · Appearance and presets → **Demo 2**
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M2.1a | `settings_load/save`: atomic write, unknown keys preserved, profile-relative | Round-trip and atomicity tests | M0.1 | R | S |
| M2.1b | Settings store: defaults merge, clamping per `settings.schema.json`, migrations, 300 ms debounce | Clamping tests; a hand-edited file loads | M2.1a | F | M |
| M2.2 | UI kit: `tokens.css` (incl. tints), base-ui wrappers, Sonner, focus ring, motion tokens, no-hex lint rule, tooltip-with-shortcut component, dev `/playground` route | All components render in the playground with keyboard focus; tint contrast asserted | M0.2 | F | M |
| M2.3a | `fonts_list` (fontdb, localized names, CJK flag) | Lists 微软雅黑 / Microsoft YaHei with the CJK flag | M0.1 | R | S |
| M2.3b | FontPicker (own-font preview, search, CJK filter) | Opens in < 100 ms | M2.2, M2.3a | F | S |
| M2.4 | Appearance panel: every §8.1 control, live preview, reset dots, validation on commit | RS-02…RS-07, RS-10, UI-03 pass | M1.6, M2.1b, M2.2, M2.3b | F | L |
| M2.5 | Presets: save, rename, delete with undo, modified/update/revert, built-in protection | RS-08, RS-09 pass | M2.4 | F | S |

### M3 · Library → **Demo 3**
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M3.1 | SQLite: schema §9.3, migrations, repo functions | CRUD tests green; cascade deletes verified | M0.1 | R | M |
| M3.2 | Import pipeline: walk dirs, BLAKE3, dedupe, copy, OPF metadata and cover (zip + quick-xml), thumbnails, TXT title cleanup, author sniffing (`作者[:：]`), events | A 50-book fixture folder imports with correct titles, authors and covers | M3.1 | R | L |
| M3.3 | Drop overlay (Tauri drag-drop events) + `Ctrl+O` / Add Books picker + Sonner result toasts | LIB-01, LIB-02 pass | M3.2, M2.2 | F | S |
| M3.4 | Library UI: grid, list, generated covers, whole-card selection tint, hover `⋯`, sort (collator), search, filter chips, context menu, remove with confirmation, empty state, double-click/Enter opens | LIB-04…LIB-08 pass; a 2,000-book synthetic library stays smooth | M3.3 | F | L |
| M3.5a | `positions` table replaces KV; window-state file under the profile | Rust tests green | M3.1, M1.5a | R | S |
| M3.5b | Routing library ↔ reader; open at last position | LIB-09, NAV-01, WIN-05 pass | M3.4, M3.5a | F | S |

### M4 · TXT and CJK (the R lane can start right after M0.1)
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M4.1 | `txt/decode.rs`: BOM → strict UTF-8 → chardetng → encoding_rs; fixture generator script (transcodes a public-domain Chinese text into every encoding) | FMT-04 corpus is 100% correct | M0.1 | R | M |
| M4.2 | `txt/split.rs` + `paragraphs.rs` + `html.rs` + `cache.rs`: default regex, headingMax, preface, fallback chunks, paragraph modes, HTML escape, manifest with global char offsets | FMT-06, FMT-07 pass on the 10-book reference set; 10 MB < 400 ms | M4.1 | R | L |
| M4.3 | `txtSource` adapter (foliate book interface) + `lang` detection (zh-Hans/zh-Hant) + `globalCharOffset` in the locator | A TXT book reads in FlowRenderer with TOC and position restore | M4.2, M1.5b | F | M |
| M4.4 | CJK typography: strict line-break, indent stripping, feature-detected `text-spacing-trim` / `text-autospace`, CJK test page | FMT-09 checklist passes; screenshot baseline stored | M4.3, M1.2 | F | S |
| M4.5 | Encoding menu + chapter-regex editor (live preview via `txt_preview_split`) + per-book TXT prefs | FMT-05, FMT-08 pass | M4.3, M3.5b | F | M |

### M5 · Navigation, chrome and window → **Demo 4 (scroll flow feature-complete)**
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M5.1a | Production window-frame hit-testing per ADR-003 (`window_frame.rs`) | §14.4 window script passes in a release build | M0.6 | R | M |
| M5.1b | Title bar and caption buttons per §6.8, top bar, footer, auto-hide with top-edge reveal, cursor hide, theme-derived chrome, `⋯` menu, `window.titleBar = native` fallback | RS-01, WIN-06, WIN-07, UI-02 pass | M2.4, M5.1a | F | M |
| M5.2 | TOC sidebar: foldable, sidebar icon, tree (2 levels expanded), current-chapter row tint and tracking, keyboard navigation, overlay vs push | NAV-02, NAV-03 pass | M5.1b | F | M |
| M5.3a | `bookmarks_*` commands | Rust tests green | M3.1 | R | S |
| M5.3b | Bookmarks: `Ctrl+D`, margin marks, Bookmarks tab, delete with undo | NAV-04, NAV-05 pass | M5.2, M5.3a | F | M |

### M6 · Layout modes (two-page is opt-in)
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M6.1 | PaginatorRenderer: one page = one column at every width; two pages opt-in with spread fallback; no animation; click zones | LM-03, LM-04 pass; one column verified at 3440 px | M1.5b | F | M |
| M6.2 | PageGridRenderer per ADR-002 (scroll + two pages, page edges, desk colour) | LM-02 passes; fps target met | M0.5, M1.4 | F | L |
| M6.3 | Layout switching (`M`, `D`, Layout menu), resize handling, cross-mode position tests | LM-05, LM-07 pass; drift ≤ 1 line in 50 automated switches; a fresh profile always starts in scroll + one page | M6.1, M6.2 | F | M |

### M7 · Keyboard system and boss key
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M7.1 | Keymap registry with persistence + Settings › Keyboard rebinding UI (record, conflicts, reserved keys, reset) | KB-01, KB-05 pass | M2.1b, M2.2 | F | M |
| M7.2 | Boss key in Rust + tray icon and menu + `boss://register-failed` + `boss_set_shortcut` | WIN-01…WIN-04 Rust-side checks pass (manual script §14.4) | M0.1 | R | M |
| M7.3 | Settings page (all panes, last-pane restore) wiring every remaining §8 setting; boss-key conflict toast and banner | UI-04, WIN-03, WIN-04 pass; every §8 key is editable in the UI (automated audit test) | M7.1, M7.2 | F | M |

**v1.0 release candidate = M0–M7 + M9.** M8 is P1 and can land before or after the RC at the owner's call (§16 Q6: by default M8 follows the RC).

### M8 · P1: stats and auto-scroll
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M8.1a | `stats_session_save`, `stats_query` (day splitting, aggregates) | Rust tests incl. midnight split | M3.1 | R | S |
| M8.1b | Session tracker (activity, idle, boss, blur), speed and time left in the footer | ST-01, ST-02, ST-04, ST-05 pass | M8.1a, M5.1b | F | M |
| M8.2 | Stats page (recharts: 30-day bars, totals, per-book table) | ST-03 passes | M8.1b | F | S |
| M8.3 | AutoScroller (shared rAF engine), keys, status pill, auto-pause | AS-01…AS-04 pass | M1.4 | F | M |

### M9 · Hardening and release
| ID | Chunk | Done when | Deps | Lane | Size |
| --- | --- | --- | --- | --- | --- |
| M9.1 | Performance pass against §11 with the perf overlay; fix regressions | All §11 targets met on the owner's PC | M7 | R + F | M |
| M9.2 | Accessibility and visual QA: contrast and tint audit, focus audit, reduced motion, DPI 100/150/200% | §6.9 checklist signed off | M7 | F | S |
| M9.3 | Packaging: NSIS installer, WebView2 evergreen bootstrapper, icon, versioning, data-dir notes | Clean install and uninstall on a fresh Windows 11 VM; data preserved on upgrade | M7 | R | S |

---

## 14. Test plan

All automated and agent-run tests use an isolated profile (`E_READER_PROFILE_DIR` → temp folder, §12.5).

### 14.1 Unit tests (Vitest, Rust `cargo test`)
- `compileStyle`: snapshot per preset × override level; CJK rules present; `text-spacing-trim` and `text-autospace` gated by feature flags; publisher multi-column CSS neutralised.
- `smoothScroller` / `autoScroller`: with a fake clock and simulated frame intervals of 16.7, 8.3 and 6.9 ms, distance after 1 s is within ±2% of the target; ramps and deceleration match the settings; OS auto-repeat is ignored; blur stops scrolling.
- `keyRouter`: scope priority, IME (`isComposing`, key `Process`) ignored, reserved keys rejected, conflict detection, layout-independent `code` matching.
- `locator`: round trip CFI ↔ charOffset on fixture documents; fallback resolution order.
- Settings: defaults merge, clamping, migration v1→v2 scaffold, unknown keys preserved; a fresh profile yields `scroll` + 1 page.
- Tokens: every tint/text pair meets §6.9 contrast, both on the dark shell and on each built-in reading preset's derived chrome.
- Rust `profile`: every path resolves under `E_READER_PROFILE_DIR` when set; the single-instance key differs per profile.
- Rust `txt::decode`: every corpus encoding (UTF-8, UTF-8 BOM, UTF-16 LE/BE, GBK, GB18030 4-byte, Big5, ASCII, Windows-1252), plus truncated multi-byte at EOF and a mixed CRLF/LF file.
- Rust `txt::split`: heading patterns (Chinese and full-width numerals, `Chapter XII`, `楔子`), long-line false positives rejected, preface, fallback chunking, paragraph auto mode on hard-wrapped fixtures.
- Rust import: OPF variants (EPUB 2 `<meta name="cover">`, EPUB 3 `properties="cover-image"`), missing cover, malformed zip → error, duplicate hash.
- Rust DB: migrations, cascades, session day-splitting at midnight.
- **Contract tests:** every JSON example in `contract/` round-trips through the Rust serde types, and the TS wrappers in `src/ipc/` type-check against the contract types.

### 14.2 Integration and E2E
- **Playwright against the Vite build with IPC mocks built from the contract** (`@tauri-apps/api/mocks`): library flows, Appearance panel live preview, preset CRUD, rebinding UI, TOC navigation, mode switching (50 random switches, drift ≤ 1 line measured via `getLocator()`).
- **`tauri-driver` + msedgedriver smoke suite** (real app, temp profile): launch, import 3 fixtures by command, open, scroll, reopen at position, settings persist across restart. The suite asserts that nothing under `%APPDATA%\com.dany.ereader\` was created or modified.
- Visual regression: Playwright screenshots of each built-in preset on an English page and a Chinese page, in scroll + one page (asserting exactly one text column) and scroll + two pages, at 1920×1080 and 3440×1440.

### 14.3 Performance tests
- Scripted scroll benchmark: hold ↓ for 10 s on a 50k-character section; record rAF deltas and long tasks (PerformanceObserver); assert §11.
- Style-change benchmark: 20 random setting changes; repaint latency and locator drift.
- TXT benchmark: decode and split 1, 10 and 50 MB fixtures in release mode.
- Library benchmark: 2,000 synthetic books; search keystroke latency; grid scroll fps.

### 14.4 Manual test scripts (run before each demo, always with a temp profile)
- **Window frame:** resize from each of the 4 edges and 4 corners (library, settings, reader with chrome hidden); drag to the left/right edges and corners to snap, and to the top to maximize; Win+←/→/↑/↓; double-click the title bar; hover the custom maximize button → Snap Layouts appears, pick a layout → the window snaps; hover/press/leave each caption button → no native caption buttons ever appear behind or over them; repeat at 100/150/200% DPI and while maximized; in the reader with chrome hidden, move the pointer to the top edge → the title bar appears within 100 ms → hover maximize → Snap Layouts appears.
- **Boss key:** focused, unfocused (another app in front), fullscreen, with the Appearance panel open, during auto-scroll, on a second monitor. Restore checks: same monitor, size, scroll position, panel state. Nothing in the taskbar or Alt+Tab while hidden, but the tray icon is still visible and restores the window. Rebind to another chord and confirm the old chord no longer works.
- **Shortcut conflicts:** start while another app holds the boss chord → a toast and a Settings banner appear, and rebinding to a free chord works.
- **IME:** with Microsoft Pinyin active in Chinese mode, single-key shortcuts still work in the reader.
- **Library folder:** with a temp profile, import a book → the copy appears in `<profile>\library`, not in Documents. With no override (manual, owner's machine only), the default resolves to `Documents\E_Reader Library`; change the folder in Settings › Library and confirm new imports land there. Check that the real Documents folder is untouched after every automated run.
- **Navigation keys:** `Home`/`End` → chapter start/end; `Ctrl+Home`/`Ctrl+End` → book start/end. In two-page scroll, `PgDn` moves exactly one row of pages (one screen).
- **Layout default:** with a fresh profile on an ultrawide window, open an EPUB and a TXT → one centred column in scroll flow; switch to paged → still one column.
- DPI 100/150/200%; reduced motion on and off.
- Drag-drop: files, folders, mixed unsupported files, 200 files at once.

### 14.5 Test corpus (checked into `tests/fixtures`, public domain only)
- EPUB: 3 Standard Ebooks titles (clean EPUB 3), 2 Project Gutenberg EPUB 2 files, one image-heavy book, one book whose CSS sets `column-count: 2`, one huge single-section book (≥ 1 MB XHTML), one fixed-layout sample (expects a message), one malformed zip.
- TXT: 红楼梦 / 西游记 (public domain) transcoded by script into every supported encoding; a hard-wrapped English text; a TXT with no headings; a 50 MB synthetic file.
- CJK typography page: mixed Han, Latin, digits, full-width punctuation at line edges, long URLs.

---

## 15. Risks

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Continuous cross-chapter scrolling is harder than expected (height estimation, anchoring jumps, iframe cost) | Medium | High (core feature) | Spike M0.4 before committing; mount at most 5 sections; native scroll anchoring plus manual correction; fallback to epub.js `continuous` manager. |
| R2 | Two-page vertical scroll (PageGrid) is complex or slow | Medium | Medium (opt-in mode) | Spike M0.5; candidate A (pure CSS) vs B (row windows); built after scroll flow and paged flow, so v1 stays usable if it slips. |
| R3 | Position drift across reflows and mode switches | Medium | High (trust) | One `Locator` model, multi-step resolution, automated drift tests (§14.2), snippet-based re-anchoring. |
| R4 | foliate-js has no tagged releases; its API may change | Medium | Medium | Pin a commit as a submodule; wrap it behind `BookSource`/`PaginatorRenderer`; upgrade only deliberately via ADR. |
| R5 | WebView2 CSS support varies (`text-spacing-trim`, `text-autospace`, `column-wrap`) | Low–Medium | Medium | Feature-detect with `CSS.supports`; degrade gracefully; WebView2 is evergreen. |
| R6 | Boss key conflicts with other apps, or fails to register | Medium | Medium | Default `Ctrl+Alt+B` (owner-confirmed; never `Ctrl+Alt+Space`); Rust registration with a clear error at startup and on rebinding; rebindable with conflict detection; the tray icon stays visible as a way to restore; `Pause` or F13+ suggested if the keyboard has them. |
| R7 | Snap Layouts on a custom maximize button is hard because the WebView2 child window covers the client area; Windows may also paint duplicate caption buttons | Medium | High (owner requirement) | Spike M0.6 in the first milestone; only documented `HTMAXBUTTON` hit-testing (§6.8); hover/press tests at 3 DPIs; `window.titleBar = native` as a temporary safety valve only. |
| R8 | Localized font names (微软雅黑 vs Microsoft YaHei) don't match in CSS | Low | Medium | Always emit the English family name from `fontdb` in CSS; show localized names only in the UI. |
| R9 | TXT chapter-regex false positives or negatives on messy web novels | High | Medium | Line-length cap, preview editor, per-book regex, fallback chunking. |
| R10 | Malicious EPUB content (scripts, remote resources) | Low | High | Sandboxed iframes without `allow-scripts`; strict CSP; no network plugins; asset scope limited to library and cache. |
| R11 | Licence contamination from AGPL/GPL reference apps | Low | High | Explicit agent rule; reviews check provenance; behaviour references only. |
| R12 | Scope creep | High | Medium | §8 is the closed settings list; §17 holds extras; only the owner promotes them (§12.7). |
| R13 | Large TXT (50 MB+) memory and startup cost | Low | Medium | Rust streaming decode; per-section HTML files loaded lazily; cache. |
| R14 | Codex and Claude Code drift apart on IPC shapes | Medium | Medium | `contract/` owned by Dany_PM; mocks and contract tests generated from the same examples; versioned contract cited in every chunk's status note. |
| R15 | Tests or agent runs damage the owner's real library | Low | High | `E_READER_PROFILE_DIR` everywhere (the library folder then defaults to `<profile>\library`, so the visible `Documents\E_Reader Library` is never touched), a single-instance lock per profile, the boss key off in test profiles, and an E2E assertion that the real profile and the real library folder are untouched (§12.5, §14.2). |
| R16 | The visible library folder is moved, edited or deleted by the user or by OneDrive sync, so DB rows point to missing files | Medium | Medium | Paths stored relative to `library.folder`; a missing file shows a clear "file missing" state with Remove; changing the folder in Settings offers to move the copies; re-importing the same file restores it by content hash. |

---

## 16. Open questions and resolved owner decisions

### Resolved owner decisions (2026-11-09)
1. **Library storage (was Q1).** Imported books are COPIED into a visible library folder, default `Documents\E_Reader Library` (Windows Documents known folder), changeable in Settings (`library.folder`). DB, settings and progress stay in the app profile. Under `E_READER_PROFILE_DIR` the library folder defaults to `<profile>\library`. No "reference in place" mode in v1 (§17).
2. **Boss key default (was Q2).** `Ctrl+Alt+B`, rebindable, with conflict detection. Never `Ctrl+Alt+Space`.
3. **Boss key hide behaviour (was part of Q2/the tray design).** The window disappears completely, including from the taskbar. The tray icon stays visible as a way to restore it.
4. **Two-page scroll geometry (was Q3).** Each page is exactly one screen (viewport) tall, so `PgDn` moves one row of pages. No fixed paper proportions in v1.
5. **Default fonts (was Q4).** Windows built-ins only: Sitka Text (Latin) and Microsoft YaHei (CJK). No bundled fonts.
6. **Home/End (was Q7).** `Home`/`End` = chapter start/end; `Ctrl+Home`/`Ctrl+End` = book start/end.

### Remaining questions (non-blocking; PM defaults apply unless the owner says otherwise)
Question numbers are kept from the earlier drafts so that references stay valid.

- **Q5. Publisher styles.** Default used: `balanced` (your font, size, spacing and colours win; headings, italics and images keep the publisher's structure). `full` override stays available in Settings.
- **Q6. P1 scope for v1.0.** Default used: the release candidate is M0-M7 + M9; stats and auto-scroll (M8) follow right after the RC unless the owner asks for them first.
- **Q8. Single-letter shortcuts** (`T`, `A`, `H`, `M`, `D`, `S`) in the reader. Default used: keep them (reader scope only, never while typing, all rebindable).
- **Q9. Windows 10 support.** Default used: Windows 11 only for v1 (tested there). Windows 10 is not a target; it would at most get plain edge snapping and Segoe UI.
- **Q10. Reading-time idle rule.** Default used: time stops after 180 s without input (`stats.idleTimeoutSec`).
- **Q11. Distribution.** Default used: local unsigned builds only (SmartScreen warns on first run). No code signing in v1.
- **Q12. Optional ideas.** Default used: nothing from §17 is promoted into v1.

---

## 17. Optional ideas (not v1 requirements)

Each of these is outside what the owner asked for. None will be built unless the owner promotes it. Former story IDs are shown in brackets.

- **Reading surface:** progress ribbon with chapter ticks and a scrubber along the page edge [RS-11]; per-book preset [RS-12]; contrast-ratio readout in the Appearance panel; separate link and heading colours; word spacing; a hyphenation toggle; dimming images in dark themes [FMT-03].
- **Layout and scrolling:** chapter-separator styles [LM-08]; mouse-wheel speed multiplier [LM-09]; a PgDn overlap marker; fixed-aspect pages, page numbers and "chapter starts on the left" in two-page scroll (the owner chose screen-height pages for v1); remembering the layout mode per book. Animated scroll-flow paging was promoted by the owner on 2026-11-10.
- **Retired section shortcuts (owner, 2026-11-10):** `chapter.next` / `chapter.prev`, formerly `]` / `[` and `Ctrl+PgDn` / `Ctrl+PgUp`, are removed entirely. This part of KB-04 is retired; Home/End and Ctrl+Home/End remain.
- **Keyboard and navigation:** shortcut cheat sheet [KB-08]; Go to percentage or chapter [KB-09]; command palette [KB-10]; back/forward jump history [NAV-07]; footnote popovers [NAV-06]; Book info dialog [NAV-08].
- **Library:** metadata and cover editor [LIB-10]; Show in Explorer; preset duplicate and drag-to-reorder; configurable cover size; a "reference in place" import mode (books stay where they are; not in v1).
- **Window and system:** reopen the last book on launch; close to tray; Mica behind library and settings (never behind content).
- **Stats:** configurable footer items [ST-06].
- **Later formats and features:** vertical CJK writing [FMT-10]; text-to-speech.
