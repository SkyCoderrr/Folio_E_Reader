# Folio: User Stories

> 2026-11-11 - Owner decision t25u: the app is now **Folio**. The original requirements below retain their historical naming. Bundle/profile identifiers, `E_READER_*` variables, Cargo names, database/settings filenames and the default `Documents\E_Reader Library` path remain unchanged. Renaming the default library folder is a later owner decision.

Status: **v1.0 - Approved 2026-11-09** · Author: Claude Code, for Dany_PM · Date: 2026-11-09
Companion doc: [PRD.md](PRD.md). Requirement sections in the PRD refer to stories by ID.
v2 applies [PRD_ADDENDUM.md](PRD_ADDENDUM.md) and the owner's decisions of 2026-11-09. Stories beyond the owner's asks were moved to PRD §17 Optional ideas. Their IDs are retired, not reused.

## How to read this

- **Persona:** "the reader". There is one user, the owner: someone who reads for long stretches on a wide Windows 11 monitor, mostly by scrolling in a single column, often in Chinese. They want to tune every visual detail, use the keyboard heavily, and like Apple's calm, clean design scheme.
- **Priority:** **P0** = must ship in v1 · **P1** = v1 nice-to-have · **P2** = later (not in v1).
- **IDs:** `<EPIC>-<nn>`. They stay the same once the owner approves, so commits and tests can cite them.
- **Acceptance criteria** use Given/When/Then for behaviour and checklists for coverage. "Default" values come from the settings model (PRD §8).
- All acceptance tests run against an isolated profile (`E_READER_PROFILE_DIR`, PRD §12.5), never the owner's real library.

| Epic | Code | Stories |
| --- | --- | --- |
| Reading surface & appearance | RS | RS-01 … RS-10 |
| Layout modes & scrolling | LM | LM-01 … LM-07 |
| Keyboard | KB | KB-01 … KB-07 |
| Boss key & window | WIN | WIN-01 … WIN-07 |
| Library | LIB | LIB-01 … LIB-09 |
| Formats: EPUB, TXT & CJK | FMT | FMT-01, FMT-02, FMT-04 … FMT-09 |
| Navigation: position, TOC, bookmarks | NAV | NAV-01 … NAV-05 |
| App UI | UI | UI-01 … UI-07 |
| Stats & progress (P1, except ST-01) | ST | ST-01 … ST-05 |
| Auto-scroll (P1) | AS | AS-01 … AS-04 |
| Later (P2) | LATER | LATER-01 … LATER-05 |

Retired in v2 (moved to PRD §17 Optional ideas): RS-11, RS-12, LM-08, LM-09, KB-08, KB-09, KB-10, LIB-10, FMT-03, FMT-10, NAV-06, NAV-07, NAV-08, ST-06, LATER-06, LATER-07, LATER-08.

---

## Epic RS: Reading surface & appearance

### RS-01 · Minimal chrome that hides while reading · P0
As a reader, I want the toolbar, title bar and footer to disappear while I read, so that only the text is on screen.

- Given a book is open, when there has been no pointer movement for `chrome.autoHideDelayMs` (default 2000 ms) and no panel or menu is open, then the top bar (which is also the title bar, with the caption buttons) and the footer fade out (opacity, 150 ms), and the cursor hides after `cursor.autoHideDelayMs`.
- Given the chrome is hidden, when the pointer moves into the top 56 px or bottom 40 px of the window, then the matching bar appears within 100 ms (opacity only, no slide) and stays while the pointer is over it.
- Given the chrome is hidden, when I press `H`, then the chrome appears and stays pinned (no auto-hide). Pressing `H` again hides it at once, and it stays hidden (edge reveal still works).
- Given a panel (TOC, Appearance) is open, then the chrome does not auto-hide.
- [ ] Hiding or showing chrome never reflows or shifts the text. Bars overlay the content; they do not push it.
- [ ] With chrome hidden, nothing is drawn except the text and the background.
- [ ] Window resizing from the edges keeps working while the chrome is hidden (WIN-07).

### RS-02 · Background and text colour · P0
As a reader, I want to set the background and text colours, so that the page matches my eyes and lighting.

- Given the Appearance panel is open, when I pick a colour with the swatch picker, then the page updates live in under 100 ms.
- Given I type a hex value, when I press Enter or leave the field, then a valid `#RRGGBB` applies at once. An invalid value shows an inline message and the previous value stays. Nothing is flagged while I am still typing.

### RS-03 · Font family, including CJK and system fonts · P0
As a reader, I want to choose separate fonts for Latin and for CJK text from every font installed on my PC, so that mixed Chinese/English text looks right.

- Given the font picker is open, then it lists all installed font families with each name drawn in its own font. CJK-capable fonts are tagged "CJK" and also shown under their localized name (for example "微软雅黑 / Microsoft YaHei").
- When I choose a Latin font and a CJK font, then the text renders with `font-family: <Latin>, <CJK>, <fallback>`, so Latin glyphs come from the Latin font and Han glyphs from the CJK font.
- [ ] The defaults are Windows built-in fonts only: Sitka Text for Latin and Microsoft YaHei for CJK. No fonts are bundled with the app.
- [ ] The picker has search and a "CJK only" filter.
- [ ] A missing font (for example after it was uninstalled) falls back cleanly, and the picker marks it "not installed".

### RS-04 · Size, weight and spacing controls · P0
As a reader, I want to adjust font size, font weight, line spacing, letter spacing and paragraph spacing, so that the text density suits me.

- [ ] Each control is a slider plus a numeric field, with the range and step from PRD §8.
- [ ] Every change previews live, and the current reading position (first visible line) stays in place during the reflow.
- [ ] Each control has a "reset to preset value" dot that appears only when the value differs from the preset.
- Given I press `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, then the font size steps up, steps down, or resets to the active preset's value (KB-07).

### RS-05 · Margins and text width · P0
As a reader, I want to set the side margins, top and bottom padding, and the maximum line length, so that lines stay readable on a very wide screen.

- Given `layout.maxLineWidthEm` = 36, when the window is 3440 px wide, then the text stays in one column at most 36 em wide, centred.
- [ ] Setting max line width to 0 means "fill the available width minus margins". It is still one column.
- [ ] If I opt into a two-page layout, margins apply per page and `layout.pageGap` sets the gap between pages (LM-02, LM-04).

### RS-06 · Alignment, justification and first-line indent · P0
As a reader, I want to control text alignment and first-line indent, so that I can format text the way I like.

- [ ] Alignment options: Publisher (EPUB only), Left, Justify. Default: Justify. Justified Latin text is hyphenated automatically.
- [ ] Indent: "Use publisher's" (EPUB), "Force" with a size in em (0–4, default 2), or None. TXT always uses the forced value.
- Given TXT paragraphs already start with full-width spaces (`　　`), when a forced indent is active, then those leading spaces are stripped, so the indent is not doubled (FMT-06).

### RS-07 · Accent/link and selection colours · P0
As a reader, I want to set the link/accent colour and the text-selection colour, so that they suit my theme.

- [ ] The accent colour applies to `<a>` in book content, to the current-chapter row tint in the TOC, and to bookmark marks.
- [ ] The selection colour applies via `::selection` inside book content, with alpha supported (default: accent at 32%).

### RS-08 · Built-in presets · P0
As a reader, I want a few good presets ready to use, so that I can start reading at once.

- [ ] Ships with **Dark** (default), **Sepia**, **Light** and **Night (low contrast)**, using the values in PRD §6.3.
- [ ] Built-in presets cannot be deleted or overwritten. Editing one and saving creates "<name> (custom)".
- [ ] Every built-in has text/background contrast ≥ 7:1, except Night, which is ≥ 4.5:1.

### RS-09 · Save and manage custom presets · P0
As a reader, I want to save my current appearance as a named preset and switch between presets, so that I can keep setups for day, night and Chinese novels.

- Given I have changed settings in the Appearance panel, when I choose "Save as Preset…", enter a name and confirm, then a preset is created that holds every appearance setting (colours, fonts, sizes, spacing, layout widths).
- Given the name field is empty, then no error is shown until I try to save. Only then does it say "Enter a name".
- [ ] Presets can be renamed and deleted. Deleting shows an undo toast for 6 s.
- [ ] The active preset chip has a whole-chip accent tint.
- [ ] When the current settings differ from the active preset, the panel shows "Modified" and offers "Update" and "Revert".
- [ ] Presets are stored in `settings.json` and survive reinstalls when the profile folder is kept.

### RS-10 · Live preview · P0
As a reader, I want every appearance change to show immediately on the real page, so that I can judge it in context.

- [ ] The Appearance panel is a side panel that does not cover the text column on screens ≥ 1280 px wide.
- [ ] Changing any value repaints within 100 ms (150 ms for a 50,000-character chapter), with no flash of unstyled content.
- [ ] Dragging a slider updates continuously. The setting is saved to disk 300 ms after the last change (debounced).

---

## Epic LM: Layout modes & scrolling

Layout is two independent choices: **flow** (Scroll | Paged) × **pages per view** (One | Two). **Scroll + One page is the default.** Two pages is always opt-in. One page always means one text column.

### LM-01 · Continuous single-column scroll (default) · P0
As a scroll reader, I want the book to scroll as one continuous, centred column, so that I never need to turn pages, even at chapter boundaries.

- Given a fresh profile, when I open any EPUB or TXT, then it shows in scroll flow with one page: a single centred text column.
- Given any window width, including 3440 px, then scroll flow with one page never splits the text into two or more columns, even if the publisher's CSS asks for columns.
- Given scroll flow, when I scroll past the end of a chapter, then the next chapter follows directly below a subtle centred rule, with no jump, reload flash or position reset.
- [ ] Scrolling up past a chapter start loads the previous chapter above without moving the text I am looking at (scroll anchoring).
- [ ] The mouse wheel, touchpad, arrow keys (KB-02) and PgUp/PgDn (KB-03) all work.
- [ ] Memory stays bounded: at most 5 chapters are mounted at once, and the others are replaced with spacers of known height.

### LM-02 · Two-page vertical scroll ("Word multi-page view", opt-in) · P0
As a reader on a wide screen, I want to optionally lay pages out two side by side, with the whole spread scrolling down continuously (1|2, then 3|4 below), so that I can use the width without turning pages.

- Given scroll flow, when I choose Two pages (`D` or the Layout menu), then pages have a fixed size and sit in rows of two with a gap of `layout.pageGap`, and the rows stack vertically with the same gap.
- [ ] It is never turned on automatically, and a fresh profile never starts in it.
- [ ] Each page holds one text column. Reading order is left page, right page, then the next row. Text flows from the bottom of page 1 to the top of page 2.
- [ ] Each page shows a faint page edge (1 px border at 6% text colour).
- [ ] Each page is as tall as the viewport minus vertical padding, so PgDn moves exactly one row (owner decision 2026-11-09: each page is exactly one screen tall; there are no fixed paper proportions in v1).
- [ ] A new chapter starts on a new page.
- [ ] Arrow keys scroll smoothly (KB-02). PgDn moves by one viewport minus the overlap (KB-03).

### LM-03 · Paged, one page · P0
As a reader, I want a single-page paginated mode, so that I can read one screen at a time when I prefer to.

- Given paged flow with one page, when I press PgDn, →, Space or click the right third of the page, then the next page appears **instantly**, with no animation.
- [ ] Each page is one text column at every window width. It is never split into two columns on a wide window.
- [ ] PgUp, ← and Shift+Space go back. At a chapter boundary, the next or previous chapter loads seamlessly.

### LM-04 · Paged, two-page spread (opt-in) · P0
As a reader, I want an optional two-page spread in paged flow, so that I can read book-style on a wide screen.

- [ ] It behaves like LM-03 but shows a left and right page and advances by one spread. It is used only when I choose Two pages.
- [ ] When the window is narrower than `layout.minSpreadWidthPx` (default 1000), it shows one page, and it returns to two pages automatically when the window is wide enough again. My choice of Two pages is kept.

### LM-05 · Switch modes without losing my place · P0
As a reader, I want to switch layout at any time without losing my place, so that I can try modes freely.

- Given I am reading at some sentence, when I switch flow (`M`, Scroll ↔ Paged) or pages per view (`D`, One ↔ Two), or use the Layout menu, then the same sentence is at the top of the new view, within one line.
- [ ] Switching flow keeps the pages-per-view choice, so One page is available in both Scroll and Paged.
- [ ] Switching is instant (< 500 ms) and has no animation.
- [ ] The choice is remembered globally (`reader.flow`, `reader.pagesPerView`).

### LM-06 · Page Up / Page Down with overlap · P0
As a scroll reader, I want PgDn to move one screen minus a couple of lines, so that I keep the last lines in view as context.

- Given scroll flow with `scroll.pageOverlapLines = 2`, when I press PgDn, then the content glides by (viewport height − 2 × computed line height) over 200 ms, so the two lines that were at the bottom are now at the top. Reduced motion makes this instant (owner decision 2026-11-10).
- [ ] The overlap is computed from the current line height in px, so it stays correct after font changes.

### LM-07 · Readable on very wide and very tall windows · P0
As a reader, I want layouts to adapt to any window size, so that a 21:9 monitor, a portrait monitor, or a half-screen snapped window all look good.

- [ ] Resizing the window reflows within 100 ms of the last resize event, and the reading position stays put.
- [ ] Two-page layouts fall back to one page below `layout.minSpreadWidthPx`.
- [ ] The minimum window size is 480 × 400 px.

---

## Epic KB: Keyboard

### KB-01 · Every reading action has a shortcut · P0
As a keyboard reader, I want shortcuts for all common actions, so that I rarely touch the mouse.

- [ ] Ships with the default map in PRD §7. It covers scrolling, paging, Home/End, TOC, appearance panel, settings, fullscreen, font size, bookmarks, layout flow and pages, chrome toggle, library and quit.
- [ ] Every icon button's tooltip and every `⋯` menu item shows its current shortcut.
- [ ] Single-key shortcuts (`T`, `H`, `M`, `D` …) work only when focus is not in a text field.
- [ ] Shortcuts work while focus is inside book content (iframes forward their key events to the app).
- [ ] Shortcuts work with the Microsoft Pinyin / Bopomofo IME active, and events with `isComposing` or key `Process` are ignored.

### KB-02 · Smooth continuous arrow scrolling · P0
As a scroll reader, I want holding ↑/↓ to scroll smoothly and continuously, so that it feels like gliding, not stepping.

- Given scroll flow (one or two pages), when I press and hold ↓, then the content starts moving within one frame. It eases up to `scroll.arrowSpeed` (default 720 px/s) over `scroll.startRampMs` (80 ms) and keeps a constant speed, driven by frame time rather than OS key repeat.
- [ ] With `scroll.acceleration` on, speed rises to `arrowSpeed × scroll.accelMax` (default 2.5×) over `scroll.accelRampMs` (800 ms) of continuous holding.
- [ ] On key release, scrolling decelerates to a stop over `scroll.stopDecelMs` (100 ms, ease-out).
- [ ] A single tap (< 120 ms) glides through `scroll.tapLines` lines (default 3), easing to zero with no final jump (owner decision 2026-11-10).
- [ ] Speed is identical on 60, 120, 144 and 240 Hz displays (± 2%).
- [ ] If the window loses focus or is hidden while a key is held, scrolling stops (no stuck key).
- [ ] Pressing ↑ while ↓ is held reverses direction smoothly.

### KB-03 · Page keys · P0
As a reader, I want PgUp/PgDn, Space and Shift+Space to page in every mode, so that one habit works everywhere.

- [ ] In scroll flow they behave as described in LM-06. In paged flow they snap to the previous or next page or spread.
- [ ] Scroll-flow paging uses a 200 ms ease-out; another physical press retargets from the current position to the previous destination plus one page. OS repeat adds no distance. Reduced motion snaps instantly (owner decision 2026-11-10).

### KB-04 · Home/End navigation · P0
As a reader, I want to jump to the start or end of a chapter or the book, so that I can move through a book quickly.

- [ ] `Home` / `End` go to the start / end of the current chapter. `Ctrl+Home` / `Ctrl+End` go to the start / end of the book (owner decision 2026-11-09).
- [ ] Animate for 200 ms when the destination is within two viewports in mounted content; otherwise jump instantly. Reduced motion snaps instantly.

The next/previous section actions and `]` / `[` / `Ctrl+PgDn` / `Ctrl+PgUp` bindings were removed by the owner on 2026-11-10; this portion is retired in PRD §17.

### KB-05 · Rebind any shortcut · P0
As a reader, I want to rebind every shortcut, including adding a second key for an action, so that the app fits my hands.

- Given Settings › Keyboard, when I click a binding and press a key combination, then it is recorded and shown in Windows notation (for example `Ctrl+Shift+T`).
- [ ] Each action supports up to 3 bindings (for example `page.next` = PgDn, Space, →).
- [ ] When a binding conflicts with another action, the UI shows "Already used by Toggle Contents — Replace / Cancel".
- [ ] Reserved keys cannot be bound: `Alt+F4`, `Alt+Tab`, `Win+…`, `Ctrl+Alt+Del`, `F12` (dev tools in debug builds).
- [ ] There are "Reset" (per action) and "Reset All" buttons.
- [ ] Bindings are stored by physical key (`KeyboardEvent.code`) plus modifiers and displayed using the current keyboard layout.

### KB-06 · Fullscreen · P0
As a reader, I want true fullscreen, so that the taskbar and title bar disappear.

- [ ] `F11` toggles fullscreen. `Esc` exits fullscreen when no panel is open. The reading position is kept.
- [ ] In fullscreen the chrome auto-hides as in RS-01. Moving the pointer to the top edge reveals the top bar, including an "Exit full screen" button.

### KB-07 · Font size keys · P0
As a reader, I want `Ctrl+=` / `Ctrl+-` / `Ctrl+0` and `Ctrl+wheel` to change the reading font size, so that I can adjust it quickly.

- [ ] Steps by 1 px from 10 to 72 px. `Ctrl+0` resets to the preset's size.
- [ ] WebView zoom is disabled, so these keys never zoom the whole UI.
- [ ] A small size label ("20 px") appears for 1 s near the top centre (opacity only).

---

## Epic WIN: Boss key & window

### WIN-01 · Global boss key hides everything · P0
As a reader, I want one global key that instantly hides the app even when another app is focused, so that nobody sees what I am reading.

- Given the app is open (any view, fullscreen or not, focused or not), when I press the boss key (default `Ctrl+Alt+B`, never `Ctrl+Alt+Space`), then within 100 ms the window is hidden. It is gone from the screen, the taskbar and Alt+Tab. The tray icon stays visible.
- [ ] Hiding pauses auto-scroll and the reading-time timer, stops any held-key scrolling, and saves the position.
- [ ] No sound, notification or toast is shown on hide.

### WIN-02 · Boss key restores exactly · P0
As a reader, I want pressing the boss key again to bring the app back exactly as it was, so that I can resume immediately.

- Given the app was hidden by the boss key, when I press it again, then the window reappears on the same monitor with the same size, position, fullscreen state, scroll position, open panels and focus, and it becomes the foreground window.
- [ ] Restoring takes less than 200 ms. The book is not reloaded (the webview stays alive while hidden).

### WIN-03 · Tray icon fallback and conflict reporting · P0
As a reader, I want a tray icon that can restore a hidden window, and I want to be told if my boss key doesn't work, so that I am never stuck or falsely confident.

- [ ] A tray icon is always present while the app runs, including while the window is hidden by the boss key.
- [ ] Left-click restores or hides the window, so the tray is always a way to restore it.
- [ ] The right-click menu has: Show/Hide, Library, Settings, Quit.
- Given another app already owns the boss-key chord, when E_Reader starts, then a toast says "Boss key Ctrl+Alt+B is in use by another app. Choose another in Settings › Keyboard." and Settings › Keyboard shows a matching banner. The app and tray keep working.

### WIN-04 · Rebind the boss key · P0
As a reader, I want to choose my own boss key, so that it does not clash with my other apps.

- [ ] Recorded like KB-05, but it must include at least one modifier, or be one of `Pause`, `ScrollLock`, `F13`–`F24`.
- [ ] The default is `Ctrl+Alt+B` and it is rebindable. `Ctrl+Alt+Space` is never the default.
- [ ] Registration is tested immediately, and success or failure ("In use by another app") is shown inline. On failure, the previous working key stays active.

### WIN-05 · Remember window state · P0
As a reader, I want the app to reopen with the same size, position and monitor, so that it is where I left it.

- [ ] Window size, position, maximized state and monitor are restored. If that monitor is gone, the window opens centred on the primary monitor.
- [ ] Only one instance runs per profile. Launching again focuses (and un-hides) the existing window.

### WIN-06 · Clean title bar with reachable caption buttons · P0
As a reader, I want a dark, minimal title bar that hides with the rest of the chrome but whose window buttons are always one motion away, so that the window has no permanent clutter and I never lose control of it.

- [ ] A custom title bar 40 px high has a drag region, double-click to maximize or restore, and Windows-style minimize/maximize/close buttons (46 × 40 px, close turns red #C42B1C on hover).
- [ ] In Library and Settings the title bar is always visible.
- [ ] In the reader the title bar is the top bar and auto-hides with the chrome (RS-01). Moving the pointer to the top edge reveals it, with the caption buttons, within 100 ms.
- [ ] `window.titleBar = "native"` switches to the native title bar as a fallback (restart required).

### WIN-07 · A frameless window that behaves like a native one · P0
As a Windows 11 user, I want the custom window to resize, snap and show Snap Layouts like any other window, so that the custom look costs me nothing.

- Given any view (including the reader with chrome hidden), when I drag any of the 4 edges or 4 corners, then the window resizes with the standard cursor.
- Given I drag the title bar to a screen edge or corner, then the window snaps. Dragging to the top maximizes it. Win+arrow keys work.
- Given the title bar is visible, when I hover the custom maximize button, then the Windows 11 Snap Layouts flyout appears, and choosing a layout snaps the window.
- Given the reader with chrome hidden, when I move the pointer to the top edge and then hover maximize, then Snap Layouts appears.
- [ ] Windows never draws a second set of caption buttons behind or over the custom ones: not on hover, press, focus change, maximize, restore, or DPI change.
- [ ] Verified at 100%, 150% and 200% scaling (PRD §14.4 window script).

---

## Epic LIB: Library

### LIB-01 · Import by drag and drop · P0
As a reader, I want to drop files onto the window, so that importing is effortless.

- Given any view, when I drag files over the window, then a full-window drop overlay appears ("Drop to add to library", accent 2 px dashed inset border, 150 ms fade).
- When I drop `.epub` or `.txt` files (or a folder, scanned recursively), then they are imported and a toast shows the result: "Added 3 books · 1 duplicate skipped · 1 unsupported".
- [ ] Unsupported files are skipped, and the toast says which ones.
- [ ] Importing never blocks the UI. Each book appears as soon as it is processed.

### LIB-02 · Import with a file picker · P0
As a reader, I want `Ctrl+O` and an "Add Books" button to open a file picker, so that I can import without dragging.

- [ ] The native Windows file dialog allows multi-select, filtered to `*.epub; *.txt`.

### LIB-03 · Library storage model · P0
As a reader, I want imported books to keep working even if I move or delete the originals, so that my library is reliable.

- [ ] Imported books are COPIED (`library.storageMode = "copy"`, the only mode in v1) into a visible library folder, default `Documents\E_Reader Library` (resolved via the Windows Documents known folder), and named by content hash. The originals are never moved or modified.
- [ ] The library folder path can be changed in Settings › Library (`library.folder`). The database, settings and reading progress stay in the app profile.
- [ ] Under `E_READER_PROFILE_DIR` (all test runs), the library folder defaults to `<profile>\library`, so tests never touch the real Documents folder.
- [ ] Duplicates (same content hash) are detected and skipped, with a note in the toast.
- [ ] There is no "reference in place" mode in v1.

### LIB-04 · Grid view with covers · P0
As a reader, I want a grid of covers with title, author and progress, so that I can recognise books at a glance.

- [ ] Covers are 150 px wide, 2:3, with a 4 px radius.
- [ ] Below each cover: title (2 lines max, ellipsis), author (1 line, secondary colour), and a thin progress bar with % in tabular numerals.
- [ ] Books without a cover (TXT, or EPUB with no cover) get a generated cover: the title on a bold, whole-card colour derived from the title hash, with title text ≥ 4.5:1 against it.
- [ ] A selected book gets a whole-card accent tint (not an outline). Hovering a card tints it and reveals its `⋯` button.
- [ ] Unread books show "New" instead of 0%. Finished books (≥ 99.5%) show "Finished".

### LIB-05 · List view · P0
As a reader, I want a compact list view, so that I can scan a big library.

- [ ] Columns: small cover, Title, Author, Format, Progress, Last read, Added. Each column is sortable by clicking its header.
- [ ] Views toggle with the toolbar segmented control or `Ctrl+1` / `Ctrl+2`.

### LIB-06 · Sort · P0
As a reader, I want to sort my library, so that the book I want is near the top.

- [ ] Sort by Last read (default), Date added, Title, Author or Progress, ascending or descending. The choice persists.
- [ ] Title and Author sort uses a locale-aware collator (`Intl.Collator('zh-Hans-CN', {numeric:true})` with Pinyin ordering for Chinese titles).

### LIB-07 · Search and filter · P0
As a reader, I want to filter by typing, so that I can find a book in a large library.

- [ ] `Ctrl+F` focuses the search box. Matching is case-insensitive substring on title and author, and results update as I type (< 50 ms for 2,000 books).
- [ ] Filter chips: All / Reading / Unread / Finished, and EPUB / TXT. The active chip is tinted.
- [ ] With no matches, the view shows "No books match 'xyz'" and a "Clear Search" button.

### LIB-08 · Remove from library · P0
As a reader, I want to remove books, so that I can keep the library tidy.

- [ ] Remove via the `⋯` / right-click menu or the `Delete` key on a selection (Ctrl/Shift-click or `Ctrl+A` selects several).
- [ ] A confirmation dialog reads: "Remove 2 books? Reading progress and bookmarks will be deleted." Buttons: **Remove** (destructive) and **Cancel** (default).
- [ ] The copied file in the library folder is deleted. The original file outside the library is never touched.

### LIB-09 · Open to last position · P0
As a reader, I want a book to open where I stopped, with no extra clicks, so that I can resume at once.

- Given a book I have read before, when I double-click it or press `Enter`, then it opens at the exact last position (NAV-01) within 800 ms for a 5 MB EPUB.
- [ ] There is no separate Open or Continue button.

---

## Epic FMT: Formats (EPUB, TXT, CJK)

### FMT-01 · Open EPUB 2 and EPUB 3 · P0
As a reader, I want any normal EPUB to open correctly, so that my existing books work.

- [ ] Reflowable EPUB 2 and EPUB 3 render with images, internal links, footnote links and the publisher's semantic styles (italics, headings, small caps).
- [ ] Internal links and footnote links jump within the book.
- [ ] Images are scaled to fit the column or page and never overflow.
- [ ] Fixed-layout EPUBs open with a clear message: "Fixed-layout books aren't supported yet". There is no crash.
- [ ] DRM-protected EPUBs show "This book is DRM-protected and can't be opened".
- [ ] Scripts in EPUB content never run. Content cannot make network requests.

### FMT-02 · Publisher style handling · P0
As a reader, I want my settings to win over the publisher's CSS where it matters, without breaking the book's structure.

- [ ] `epub.styleOverride`: `minimal` (colours only), `balanced` (default: colours, body font family, size, line height, spacing, alignment, margins, while headings keep relative sizes and italics/bold are kept), or `full` (publisher CSS removed apart from basic semantics).
- [ ] In every level, publisher multi-column CSS is neutralised so a page stays one column (LM-01, LM-03).

### FMT-04 · Open TXT with automatic encoding detection · P0
As a reader of Chinese web novels, I want any TXT to open with the right characters automatically, so that I never see mojibake.

- [ ] Detection order: BOM (UTF-8, UTF-16 LE/BE) → strict UTF-8 validation → statistical detection between GB18030 (superset of GBK/GB2312), Big5 and Windows-1252.
- [ ] The test corpus decodes correctly for: UTF-8, UTF-8 BOM, UTF-16 LE, UTF-16 BE, GBK, GB18030 (including 4-byte characters), Big5, and plain ASCII.
- [ ] The detected encoding is shown in the Text Encoding menu ("Auto (detected GB18030)").

### FMT-05 · Override TXT encoding · P0
As a reader, I want to override the encoding when detection is wrong, so that I can always fix a garbled book.

- [ ] The book's `⋯` / right-click menu › "Text Encoding" offers Auto (detected X), UTF-8, UTF-16 LE, UTF-16 BE, GB18030, Big5, Shift_JIS, EUC-KR, Windows-1252. The same menu is in the reader's `⋯` menu.
- [ ] Choosing one re-decodes and re-splits the book within 1 s for a 10 MB file and keeps the position by character offset.
- [ ] The override is saved per book.

### FMT-06 · TXT paragraphs · P0
As a reader, I want TXT paragraphs detected sensibly, so that the text doesn't run together or break mid-sentence.

- [ ] `txt.paragraphMode`: `line` (each non-empty line is a paragraph), `blank` (blank-line separated, so wrapped lines are joined) or `auto` (default: picks `blank` if over 50% of lines are hard-wrapped at a near-constant width, otherwise `line`).
- [ ] Leading ASCII and full-width spaces are trimmed from paragraphs (the indent comes from RS-06). Runs of more than 2 blank lines collapse.
- [ ] Line endings CRLF, LF and CR are all handled.

### FMT-07 · Automatic TXT chapter splitting · P0
As a reader, I want TXT books split into chapters with a real TOC, so that I can navigate long novels.

- [ ] The default heading pattern matches lines like `第12章 标题`, `第一百二十回`, `第三节`, `第五卷`, `卷三`, `Chapter 12`, `CHAPTER XII`, `序章`, `楔子`, `引子`, `尾声`, `后记`, `番外…`, allowing leading spaces, full-width digits, and Chinese numerals 〇一二三四五六七八九十百千万两.
- [ ] Only lines of ≤ `txt.headingMaxChars` (default 40) characters count as headings, to avoid false positives inside prose.
- [ ] Text before the first heading becomes a section titled "Preface / 前言" (if it is non-empty).
- [ ] If fewer than 2 headings are found, the book is split into parts of about `txt.fallbackChunkChars` (10,000) characters at paragraph boundaries, titled "Part 1, Part 2…".
- [ ] A 10 MB GB18030 file decodes and splits in < 400 ms (release build, mid-range PC).

### FMT-08 · Custom chapter regex · P0
As a reader, I want to edit the chapter-heading regex, globally or per book, so that unusual books still split correctly.

- [ ] Settings › TXT & CJK shows the global regex. The book's `⋯` menu › "Chapter Detection…" opens a per-book editor.
- [ ] The editor shows a live preview: the number of chapters found and the first 20 matched headings, updated as I type (debounced 250 ms). An invalid regex shows an inline error once I pause typing, and the last valid preview stays visible.
- [ ] "Apply" re-splits the book and keeps the position by character offset. "Reset" restores the default.

### FMT-09 · First-class CJK typography · P0
As a reader of Chinese, I want line breaking, punctuation and spacing to follow CJK conventions, so that the text looks typeset, not dumped.

- [ ] Line breaking uses `line-break: strict` (kinsoku: no line starting with `，。、；：？！）」』》` and no line ending with `（「『《`), and `word-break: normal` with `overflow-wrap: anywhere` for very long Latin strings.
- [ ] Justification spreads space between CJK characters evenly. No visible rivers appear in the test page at 20 px / 36 em.
- [ ] `text-spacing-trim` (punctuation trimming) and `text-autospace` (space between CJK and Latin/digits) are applied when the WebView2 runtime supports them (feature-detected). Toggles: `cjk.punctuationTrim` (default on) and `cjk.autospace` (default on).
- [ ] Content `lang` is set from EPUB metadata, or from TXT detection (`zh-Hans` / `zh-Hant`, using the Big5 decoder or a character-frequency heuristic), so the right glyph variants and fallback fonts are picked.
- [ ] Full-width punctuation never gets letter-spacing added after it at line end.

---

## Epic NAV: Position, TOC, bookmarks

### NAV-01 · Remember last position automatically · P0
As a reader, I want every book to reopen exactly where I stopped, so that I never hunt for my place.

- [ ] The position is saved 1 s after scrolling stops, on mode switch, on book close, on boss-key hide and on app quit.
- [ ] The position is stored as a locator: EPUB CFI plus a character offset within the section plus overall progress.
- [ ] Restoring puts the same line at the top of the viewport (± 1 line), even if font settings changed since.

### NAV-02 · Foldable TOC sidebar · P0
As a reader, I want a foldable table of contents on the left, so that I can see the book's structure and jump around, then fold it away.

- [ ] `T` or the sidebar-toggle button (a sidebar icon, not a hamburger; tooltip "Contents  T") folds and unfolds it. It is 300 px wide and overlays the content on windows < 1280 px. On wider windows it pushes the text column.
- [ ] It shows at most 2 nesting levels expanded by default. Deeper levels collapse behind disclosure chevrons.
- [ ] Clicking an entry or pressing Enter jumps there.
- [ ] Keyboard: ↑/↓ move the selection inside the TOC when it has focus, ←/→ collapse/expand, `Esc` returns focus to the page.
- [ ] Its folded or unfolded state is remembered.

### NAV-03 · Highlight the current chapter in the TOC · P0
As a reader, I want the current chapter to stand out in the TOC, so that I can see where I am at a glance.

- [ ] The entry for the chapter at the top of the viewport gets a whole-row accent tint, weight 600 and primary text colour. The highlight updates while scrolling (throttled to ≤ 10 Hz).
- [ ] When the sidebar opens, the current entry is scrolled into view (centred).

### NAV-04 · Add and remove bookmarks · P0
As a reader, I want to bookmark my current position with one key, so that I can return to it later.

- [ ] `Ctrl+D` toggles a bookmark at the first visible line. The bookmark stores the locator, a 60-character text snippet, the chapter title and a timestamp.
- [ ] A bookmark in view shows a small accent mark in the margin beside its line. Clicking the mark removes it (undo via toast).

### NAV-05 · Bookmarks list · P0
As a reader, I want to see all bookmarks for a book in one place, so that I can jump back to any of them.

- [ ] The sidebar has two tabs: **Contents** | **Bookmarks** (`Ctrl+B` opens it on Bookmarks).
- [ ] Each bookmark row shows the chapter title, snippet, % and relative date (switching to an absolute date after 7 days). Rows sort by book position.
- [ ] Clicking a row jumps there. Delete appears on hover and is also available with the `Delete` key (undo via toast).

---

## Epic UI: App UI

### UI-01 · Dark, calm app UI in Apple's design scheme · P0
As a reader, I want the whole app (library, settings, panels) to be dark, quiet and well-crafted, so that it feels like one product.

- [ ] Follows Apple's general design scheme: clean typography, calm spacing, clear hierarchy, soft depth and restrained motion. It does not use Liquid Glass or translucent materials. All surfaces are solid, and the reading surface is always a solid colour.
- [ ] Uses only the tokens in PRD §6.2. No hard-coded colours outside the token file.
- [ ] State uses bold whole-row or whole-card tints (current TOC chapter, selected book, active Settings pane, active preset, active filter chip), not thin accent bars.
- [ ] Text contrast: primary ≥ 7:1, secondary ≥ 4.5:1 on its surface, including on tints.

### UI-02 · Reader chrome follows the reading theme · P1
As a reader, I want the reader's bars and panels to match my page colours, so that a light page never sits under a black bar.

- [ ] Reader overlays (top bar, footer, sidebar, Appearance panel) derive their colours from the active reading preset: surface = background mixed 6% toward text, with the same text colour, and tints derived from the preset's accent.
- [ ] Tinted states stay readable on every built-in preset (primary text ≥ 7:1, checked by tests).

### UI-03 · Appearance panel · P0
As a reader, I want one panel for all reading-appearance settings next to the page, so that I can tune the look while I read.

- [ ] `A` or the "Aa" toolbar button opens a right-side panel (360 px) with sections: Presets, Colours, Fonts, Size & Spacing, Layout, CJK. Every control previews live (RS-10).
- [ ] The panel does not steal arrow keys from the page unless a control inside it has focus.

### UI-04 · Settings page · P0
As a reader, I want one Settings page for everything that isn't reading appearance, so that I know where to find it.

- [ ] `Ctrl+,` opens Settings as a full in-app page with a left nav: General, Reading, Scrolling, Keyboard, Library, TXT & CJK, Stats, About. The active pane is tinted. It reopens on the last-viewed pane. `Esc` or the back button returns to where I was.

### UI-05 · Keyboard focus visible everywhere · P0
As a keyboard user, I want to always see where focus is, so that I can operate everything without the mouse.

- [ ] Every interactive element is reachable by Tab. Focus shows a 2 px accent ring with a 2 px offset (`:focus-visible` only).

### UI-06 · Respect system motion setting · P0
As a reader, I want the app to follow Windows' animation setting, so that I control motion in one place.

- [ ] With Windows "Animation effects" off (`prefers-reduced-motion: reduce`), all movement (slides, scale) is removed and only opacity fades of ≤ 150 ms remain. There is no separate in-app motion toggle.

### UI-07 · Lean surfaces and direct manipulation · P0
As a reader who dislikes clutter, I want every screen to show only what I need, with secondary actions tucked away, so that the app stays calm.

- [ ] No redundant controls: books open by double-click or `Enter`, so there is no Open button.
- [ ] Secondary actions live in a `⋯` menu, the right-click menu, or appear on hover.
- [ ] Icons are clear: the sidebar toggle uses a sidebar icon (`PanelLeft`), never a hamburger. Every icon-only button has a tooltip with its name and shortcut.
- [ ] Validation runs only after I act (Enter, leaving a field, or clicking Save). No "required" or format errors appear on untouched or in-progress fields.
- [ ] Motion appears only when it is physically correct: panels slide from their own edge, menus grow from their trigger, and keyboard actions are instant except for continuous scroll-flow navigation (PRD §6.6; owner decision 2026-11-10).
- [ ] Any draggable item can be picked up by press-and-hold anywhere on it (no handle). On drop it glides from where it was released into place. Neighbours make room by moving, with no insertion line. (Binding for any drag interaction; v1 has no reorderable lists.)

---

## Epic ST: Stats & progress (P1)

### ST-01 · Progress percentage · P0
(Kept P0 because the library and footer need it.)
As a reader, I want to see how far through a book I am, so that I know my progress.

- [ ] Book progress % is shown in the footer (chrome) and in the library, with 1 decimal place in the footer and integers in the library, using tabular numerals.
- [ ] Progress is computed from character position over total characters (EPUB section sizes are refined to character counts in the background after first open).

### ST-02 · Time read per book · P1
As a reader, I want to know how much time I've spent on each book.

- [ ] Time counts only when the reader view is visible and not boss-key hidden, and there has been input or auto-scroll within `stats.idleTimeoutSec` (default 180 s).
- [ ] Sessions shorter than 10 s are discarded.

### ST-03 · Time read per day · P1
As a reader, I want to see how much I read each day, so that I can follow my habit.

- [ ] The Stats page shows a bar chart of minutes per day for the last 30 days and totals for today, this week and this month.

### ST-04 · Reading speed · P1
As a reader, I want to know my reading speed, so that time-left estimates make sense.

- [ ] Speed = characters advanced ÷ active minutes, shown as "chars/min" for CJK books and "words/min" for Latin books (words ≈ Latin chars ÷ 5.5).
- [ ] Jumps larger than one screen (TOC, links, chapter keys) are excluded. A rolling window of the last 30 active minutes is used per book.

### ST-05 · Time left · P1
As a reader, I want to know how long the chapter and book will take, so that I can decide whether to keep going.

- [ ] The footer shows "12 min left in chapter", and the Stats page and library list show time left in the book, based on the current speed. Both stay hidden until there are 5 active minutes of data for that book.

---

## Epic AS: Auto-scroll (P1)

### AS-01 · Start and stop auto-scroll · P1
As a reader, I want the text to scroll on its own at a steady speed, so that I can read hands-free.

- [ ] `S` starts or stops auto-scroll in scroll flow (one or two pages). In paged flow it advances one page every N seconds, derived from the speed.
- [ ] `Space` pauses or resumes while auto-scroll is active. A tiny status pill ("Auto 40 px/s") shows for 1.5 s on change.

### AS-02 · Adjust speed while running · P1
As a reader, I want to speed up or slow down without stopping, so that the pace matches my reading.

- [ ] `=` / `-` (no modifier) change speed by `autoscroll.step` % (default 10%), from 5 to 400 px/s. The speed is remembered globally.

### AS-03 · Smoothness · P1
As a reader, I want auto-scroll to look perfectly smooth, so that it is comfortable to read while moving.

- [ ] Motion is sub-pixel and frame-time based, with no visible stepping at 10 px/s on a 60 Hz display.

### AS-04 · Auto-pause · P1
As a reader, I want auto-scroll to stop when I'm clearly doing something else, so that I don't lose my place.

- [ ] Auto-scroll pauses when a panel opens, on manual scroll input, on boss key, on window blur (`autoscroll.pauseOnBlur`, default on), and at the end of the book.

---

## Later (P2): not in v1

These are the items the owner listed as "later". Other ideas are in PRD §17 Optional ideas.

| ID | Story |
| --- | --- |
| LATER-01 | Highlights and notes: select text to highlight in colours, attach notes, export to Markdown. |
| LATER-02 | In-book full-text search with a result list and match highlighting. |
| LATER-03 | MOBI / AZW3 (non-DRM) support (foliate-js has a MOBI parser). |
| LATER-04 | PDF support. |
| LATER-05 | Sync of positions, bookmarks and settings between machines (for example via a user-chosen folder). |
