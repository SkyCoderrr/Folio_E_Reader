# Folio addendum: owner preferences learned from his other projects (apply to PRD and stories)

> 2026-11-11 - Owner decision t25u: the app is now **Folio**. The original requirements below retain their historical naming. Bundle/profile identifiers, `E_READER_*` variables, Cargo names, database/settings filenames and the default `Documents\E_Reader Library` path remain unchanged. Renaming the default library folder is a later owner decision.

UI and design
- Owner CORRECTION: he likes Apple's overall design scheme (clean typography, calm spacing, clear hierarchy, soft depth, restrained physical motion), NOT specifically Liquid Glass. Glass/Mica translucency is optional at most, never core. The reading surface is always a solid, clean colour.
- Frameless custom window, but it MUST resize from every edge and corner, snap to screen edges, and show Windows 11 Snap Layouts when hovering the custom maximize button. Windows must not draw a second set of caption buttons behind the custom ones.
- Bold colour use (e.g. whole-card tints rather than thin accent bars), readable in light and dark.
- Lean surfaces, no redundant controls: double-click opens a book, so no Open button; secondary actions in a "⋯" menu, right-click context menu, or on hover.
- Clear icons: a proper sidebar-toggle icon (not a hamburger). Foldable sidebar.
- Animation is welcome only when physically correct (e.g. dragged items glide from where they were dropped). No insertion lines when other items already move. Direct manipulation: press-and-hold anywhere on an item to drag.
- Heavy keyboard user. Show shortcuts in tooltips. Ctrl+Alt+Space is already taken on his PC, so choose a different default boss key (and make it rebindable, detect conflicts if registration fails).
- Prefer robust features over clever OS tricks.
- Validation only after the user acts; no premature "required" errors.

Workflow (put in PRD process/milestone sections)
- Codex owns the Rust/Tauri backend; Claude Code owns the React UI. Both build against shared contract docs in contract/ (Tauri command names, args, return types, events, error shapes, settings schema). The PM (Dany_PM) owns contract changes.
- Every agent exchange is logged to .agent-logs/conversation.md.
- Work on feature branches (feature/<name>); never commit to main, push, merge or reset without the owner's approval.
- Protect real user data: the app profile path (library DB, settings, progress) must be overridable via an env var (e.g. E_READER_PROFILE_DIR) so test runs use an isolated profile.
- Leave work in a clean, resumable state at each milestone.
- No feature creep: stick to what the owner asked; list any extra ideas briefly as optional suggestions, not requirements.


# Owner answers to PRD open questions (2026-11-09) - apply after the revision pass
- Library storage: copy imported books into a VISIBLE library folder in Documents (e.g. Documents\E_Reader Library), path changeable in settings.
- Boss key default: Ctrl+Alt+B, must be rebindable.
- Boss key hide: keep the tray icon as a way to restore the window.
- Two-page scroll: each page is exactly one screen tall, so Page Down moves one row of pages.
- Default fonts: Windows built-ins (Sitka Text for Latin, Microsoft YaHei for CJK); no bundled fonts.
- Home/End: chapter start/end; Ctrl+Home/Ctrl+End: book start/end.


# Owner/PM decision (2026-11-10): chrome stays dark, only the reading surface follows the preset
- Reverses UI-02 "chrome adopts the reading theme". The reading surface (page background, text, the gutter/desk between two pages, and the footer/progress strip inside the reading area) follows the chosen preset. ALL other chrome (title bar, menus, Appearance panel, Settings, TOC sidebar, dialogs, inputs, toasts, auto-scroll pill) stays in the app's dark theme regardless of preset.
- The two-page gutter is a subtle preset-derived tone: background mixed 5% toward the text colour, never black on light presets.
- General settings: the "Reading appearance" row is removed (redundant with the Appearance panel). The "Title bar" row stays with the note "Applies after restart" (Rust reads window.titleBar at startup; there is no relaunch command in the contract, so no "Restart now" button).


# Owner decision (2026-11-11, t20u #5/#6): two pages = horizontal filmstrip, page turns animated
- Two pages (both reader.flow values) are a horizontal filmstrip: each page one screen tall; every advance (wheel, ArrowDown/Right, PgDn, Space, click zone, auto-scroll) moves ONE page - the left page slides out left, the right page moves into the left slot, the next page enters on the right. Back is the reverse. Held keys and a continuous wheel/touchpad move the strip continuously and settle on a page boundary. Replaces "Two-page scroll: each page is exactly one screen tall, so Page Down moves one row of pages" (2026-11-09) and the vertical two-page rows (ADR-002).
- A chapter's last page and the next chapter's first page may sit side by side (no blank page); at the book end the last page rests on the right.
- Page turn (paged, one page) slides: ~180 ms ease-out, transform-only, next = slides left, prev = slides right; a new turn finishes the running one instantly; OS reduced motion = instant. Next page painted within 50 ms of the key press.
- Single column (scroll, one page) stays the default. Narrow-window fallback to one page below layout.minSpreadWidthPx is unchanged. No new setting; contract unchanged. Details: docs/decisions/ADR-005-filmstrip.md.

## 2026-11-11 t24u — TOC reading state (read / current / percent)

In the Contents tab (EPUB and TXT chapters alike, updated live on every relocate):
- **Current entry** = among entries whose start section is at or before the reader's `sectionIndex`, those with the latest start section; the first of them in document order, then descended to its deepest child that starts in that same section. Parents of the current entry keep normal emphasis. Before the first entry (cover) there is no current entry.
- **Read** = entries whose start section is before the current entry's start section (excluding ancestors of the current entry). Rule uses the current position, not a stored "furthest" position; jumping back un-reads later chapters. **Unread** = everything else (normal emphasis). Entries whose href does not resolve are never read/current. Fragment anchors inside a section are not resolved.
- **Look**: read = muted (`--chrome-text-3`); current = accent text, accent tint, a 6 px accent dot before the label, and a compact `NN%` right-aligned in accent.
- **Percent** = (`Locator.progress` − chapter start fraction) / (next later-starting entry's start fraction − chapter start fraction), fractions from cumulative `Section.size`; rounded, capped at 99 except 100 at the very end of the book (progress ≥ 0.99995 in the last chapter).
- No new settings, nothing persisted or synced. Logic: `src/features/toc/tocModel.ts` (`buildTocSpans`, `classifyToc`), tests `tocModel.test.ts`.

## 2026-11-11 t24u — two-page backdrop, panel dismissal, page height

- The two-page strip paints no desk/gutter at all: the page background fills the whole reading surface (the section documents were opaque anyway, so the old gutter only showed as grey tabs in the top/bottom margins and as a bar while a renderer mounted). Supersedes the "subtle gutter tone" line above for the paged/filmstrip renderer.
- A primary press anywhere on the reading surface, including inside the book iframe, closes the Appearance panel and the Layout popover and is consumed (no page turn, link or text selection from that press). Esc is unchanged.
- The page's text box is a whole number of lines, centred in the vertical margins, so the top and bottom empty bands match (no extra partial-line band at the bottom on tall/maximized/fullscreen windows).

## 2026-11-11 t28u/t29u — TOC visit memory (supersedes the t24u "read" inference)

- **Read = visited.** A chapter is read once the reader has actually been in it: the position resolves into its TOC entry and stays there for a dwell of ~1 s (`VISIT_DWELL_MS`), so its text was on screen; reading part of it is enough. The mark is written with `chapter_mark_read` (one write in flight per book, deduped per session, retried on a later visit if it failed) and the set is loaded with `chapters_read_get` on book open (contract v0.6.0). Once read, a chapter stays read, also after jumping back; there is no unmark.
- **Skipping never marks.** A TOC jump, Ctrl+End, a link or a held-key glide marks only the chapter the reader settles in (dwell restarts on every chapter change); chapters in between stay unread. The old rule "everything before the current position is read" is gone.
- **chapterKey** (opaque to Rust, non-empty, <= 512 bytes): EPUB `s:<spine index>#<fragment or empty>` from the TOC entry's href; TXT `t:<chapter index>`. Built from book structure only, so it survives reopen and re-layout. Entries whose href does not resolve have no key and are never marked.
- **Look (sidebar, fixed dark chrome, same in Dark/Light/Sepia):** last-read chapter (the entry containing the current/saved position) = accent text + tint + accent dot + the only `NN%` in the list; every other visited chapter, finished or partial, = muted `--toc-read` (#a8a59f, ~47% of `--text-1` luminance, 6.0:1 on `--surface-1`), no %, no accent; never-visited chapters = `--text-1` (#eceae6). The last-read chapter keeps the current look even if it was read before. Tests pin the token ratio (45-55%, >= 3:1).
- Marking pauses while the reader is suspended (boss key). Within one spine file the entry is resolved at section granularity (fragments are not located). Code: `src/features/toc/chapterMemory.ts`, `useChapterMemory.ts`, `tocModel.ts` (`chapterKeyFor`, `classifyToc`).

## 2026-11-11 t31u — optional reading-progress readout in the page footer

- **Setting** `chrome.footerProgress` (`off` | `percent` | `chapter` | `both`, default `off`, contract 0.7.0). Control: Settings > Reading > Auto-hide group (next to the toolbar auto-hide delay), one segmented control "Reading progress": Off / Percentage / Chapter / Both. Applies live and persists via `settings_patch`.
- **Readout** is plain text only, in the bottom-right corner of the reading area (inset like the footer bar's text; bottom-right of the right page in two-page), in the muted text colour of the active reading preset: `37%`, `6/24`, or `6/24 · 37%`. No bar, strip, background, border, shadow, padding or reserved height, and it takes no pointer events. It stays visible while the toolbar and footer bar auto-hide, and fades out while the footer bar is showing (the bar carries the position itself). Same in windowed, maximized and F11, one or two pages. With Off nothing is rendered, so the reading surface is unchanged.
- **Chapter rule:** current/total over the TOC flattened pre-order at every depth, counting only entries whose href resolves to a section (the same entries and the same "current entry" rule as the TOC sidebar; TXT uses its chapter list). Before the first entry, or in a book without a TOC, Chapter shows nothing and Both shows only the percentage.
- **Percentage** = whole-book progress, rounded down; 100% only at the very end.
- Code: `src/features/reader/footerReadout.ts`, `ReaderChrome` (`readout` prop), `ReaderView`, `settings/panes.tsx`. Tests: `footerReadout.test.ts`, `ReaderChrome.readout.test.tsx`.
