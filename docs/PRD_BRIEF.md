# Brief for Claude: write the user stories and PRD for "Folio"

> 2026-11-11 - Owner decision t25u: the app is now **Folio**. The original requirements below retain their historical naming. Bundle/profile identifiers, `E_READER_*` variables, Cargo names, database/settings filenames and the default `Documents\E_Reader Library` path remain unchanged. Renaming the default library folder is a later owner decision.

You are helping a product manager (Dany_PM) write planning docs. Do NOT write any app code yet. Write two files:
- docs/USER_STORIES.md : user stories grouped by epic, each with "As a reader, I want..., so that..." plus concrete acceptance criteria (Given/When/Then or checklist), and a priority (P0 = v1 must, P1 = v1 nice-to-have, P2 = later).
- docs/PRD.md : a full PRD: overview and goals, non-goals, target user, principles, feature requirements (referencing story IDs), UX and visual design spec, keyboard shortcut map, settings model (every setting with type, default, range), data model and storage, architecture and tech stack, performance targets, milestones broken into small implementable chunks that coding agents (Claude Code and Codex) can each take, test plan, risks, and open questions for the owner.

Before writing, read these design references and apply them to the UX/visual section (dark theme, modern, calm, typographic):
- C:\Users\sky20\Documents\Projects\_design-skills\emilkowalski-skills\skills\emil-design-eng\SKILL.md
- C:\Users\sky20\Documents\Projects\_design-skills\emilkowalski-skills\ui-cheatsheet.md
- C:\Users\sky20\Documents\Projects\_design-skills\emilkowalski-skills\skills\pick-ui-library\SKILL.md
- C:\Users\sky20\Documents\Projects\_design-skills\apple-design-skill\SKILL.md
- C:\Users\sky20\Documents\Projects\_design-skills\apple-design-skill\references\hig\dark-mode.md, typography.md, color.md, sidebars.md, settings.md, keyboards.md, going-full-screen.md, scroll-views.md
Note: this is a Windows desktop app, so adapt Apple guidance to Windows conventions where they differ.

## Product context
A personal, highly customizable e-reader for a Windows PC with wide/landscape screens (most existing readers are built for vertical phone screens). The owner wants to customize everything. Single user, local only, no accounts or cloud sync.

## Recommended stack (from prior research; confirm or argue against it in the PRD)
- Tauri v2 (Rust) + React + TypeScript + Vite. Machine has Node 26, Rust/cargo, Python 3.13, git.
- Rendering: foliate-js (MIT, https://github.com/johnfactotum/foliate-js), pinned as a git submodule or vendored. It has a CSS multi-column paginator and a scrolled mode. epub.js is a fallback only.
- Design references (do not copy AGPL/GPL code): Readest (AGPL), Koodo Reader (AGPL), Alexandria (GPL, Tauri + epub.js).
- Keep the codebase small, modular and easy to tweak; all styling driven by a central settings/theme model.

## Formats
- EPUB is primary. TXT is secondary but important.
- The owner reads a lot of Chinese books: TXT must auto-detect encoding (UTF-8, UTF-8 BOM, UTF-16, GBK/GB18030, Big5) and auto-split chapters by common headings (e.g. 第X章 / 第X回 / 第X节 / Chapter N, with a configurable regex). CJK typography must be first-class: CJK font choices, proper line breaking, punctuation handling, optional first-line indent (2em), paragraph spacing.

## Requirements from the owner (in priority order)
1. Clean reading space (P0). Minimal chrome that hides while reading. Maximum customization: background colour, text colour, font family (incl. CJK fonts and system fonts), font size, font weight, line spacing, letter spacing, paragraph spacing, margins/padding, text width/column width, text alignment/justification, first-line indent, link/accent colour, selection colour. Saveable custom theme presets, plus a few built-in presets (dark, sepia, light, low-contrast night). Live preview of changes.
2. Scrolling first (P0). The owner is a scroll reader and rarely turns pages.
   - Single-column continuous vertical scroll.
   - Two-page mode works like Microsoft Word's multi-page view: pages sit side by side (left and right) and the whole spread scrolls DOWN vertically together; row after row (pages 1|2, then 3|4 below, etc.). No page turning required.
   - Also build a paginated mode (one page or two-page spread) that snaps instantly to the next page/spread with NO page-turn animation.
   - Mode is switchable at any time and keeps the reading position.
3. Keyboard (P0).
   - Up/Down arrows: smooth, continuous scrolling while held (not jumpy steps), with customizable scroll speed and optional acceleration/easing.
   - Page Up / Page Down: scroll by one screen minus a configurable number of overlap lines (default about 2 lines) so the reader keeps context at the bottom. In paginated mode they snap to the previous/next page.
   - Home/End, chapter next/previous, toggle TOC, toggle settings, fullscreen, font size up/down, etc. All shortcuts rebindable.
   - Global "boss key" (works even when the app is not focused): hides the window completely, including from the taskbar; pressing it again restores to exactly where the reader was. Rebindable. Consider a tray icon as a fallback to restore.
4. Library (P0): import books by drag and drop onto the window or via a file picker. Grid and list views with covers, title, author, progress; sort and search/filter; remove from library; open to last position. Decide and document whether files are copied into an app library folder or referenced in place (recommend one, list as open question).
5. Dark theme, modern UI for the whole app (P0).
6. v1 extras:
   - Bookmarks and automatic remember-last-position per book (P0).
   - Table of contents sidebar (P0), collapsible, highlights current chapter.
   - Reading stats and progress (P1): progress %, time read per book and per day, reading speed, estimated time left in chapter/book.
   - Auto-scroll / hands-free reading (P1) with adjustable speed, pause/resume key, speed up/down keys.
7. Not in v1 (P2, list as later): highlights and notes, in-book search, other formats (MOBI/AZW3/PDF), sync.

## Process expectations
- The owner approves the PRD first, then wants to see a working build.
- Milestones should be ordered so that a usable reader (open an EPUB, scroll it with custom styling) appears early.
- Put the open questions you think are most important at the end of the PRD.

Write the two files now, in clear Markdown. Be specific and concrete; avoid filler.
