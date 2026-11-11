# ADR-002: PageGridRenderer (scroll flow, two pages per view, opt-in)

- Status: **Accepted as a prototype (candidate A). Go/no-go waits on the in-app measurements below, starting with G0.**
- Date: 2026-11-10
- Chunks: M0.5 (Spike B); groundwork for M6.2 (PageGridRenderer per this ADR) and M6.3 (layout switching)
- Author: Claude Code (UI lane). Decision owner: Dany_PM.
- PRD: §5.2 (FR-LM-0/2/4), §8.2 (owner decision: each page is exactly one screen tall), §10.3, §10.4 step 5, §11, §13 (M0.5, M6), §15 R2/R5. Stories: LM-02, LM-05, LM-07.

## Context

Two pages per view in scroll flow ("Word multi-page view") must show fixed-size pages in rows of two. The rows stack vertically and scroll continuously across chapters. Each page is exactly one viewport tall, so `PgDn` moves one row (owner decision 2026-11-09). One page holds exactly one text column. The mode is **opt-in only**: FlowRenderer stays the default, and nothing switches to two pages automatically (FR-LM-0). Mode switches and resizes must keep the locator within 1 line (FR-LM-4). The smoothScroller, key router and locator persistence that drive FlowRenderer (ADR-001, M1.4, M1.5b) must drive this renderer unchanged.

The hard part is the layout itself. Text has to flow left page → right page → next row's left page. A single CSS multicol container only lays its columns out horizontally, so one more line of text does not simply go "down".

## Candidates

### A: CSS Multicol Level 2 row wrapping inside each section iframe

The section document's root becomes a multicol container with `column-count: 2`, `column-height: <page text height>` and `column-wrap: wrap`. When a row of two columns is full, the next column starts a **new row below**. `row-gap` sets the space between rows. The browser does the pagination, and the document grows in height by one row at a time. The iframe stays auto-height, as in FlowRenderer.

### B: horizontal paginated strip + "row windows"

Each section is laid out the classic paginated way (fixed height, columns overflow horizontally into N pages). To show those pages as rows of two stacked vertically, each visible row needs its **own clone** of the section: an iframe clipped to two pages and offset by `−row × 2 × (pageW + gap)`. One rendered document can only be painted in one place, and Chromium has no `element()`/regions. If ~2 rows are visible and ±1 row is kept ahead, that is 3–4 full layouts of the same chapter per mounted section. Clones would be recycled by changing their horizontal offset as rows scroll by.

### Comparison

| | A: `column-wrap` | B: row windows |
| --- | --- | --- |
| Iframes per mounted section | 1 | 3–4 (clones), recycled while scrolling |
| Layout cost per mount | 1 × chapter (fragmented) | 3–4 × chapter |
| Memory (≤ 5 sections mounted) | ≈ FlowRenderer | ≈ 3–4 × FlowRenderer |
| Scroll model | One tall track; section height = rows × viewport. Reuses ADR-001's slots, estimation, anchoring, virtualization and key forwarding | Two-level virtualization (sections, then rows within sections). Clone recycling on the scroll path, so frame-time risk |
| Locator / selection | One document per section; caret hit-testing works directly | Must map points through the clone's offset. A selection cannot span two rows (two documents) |
| Style change | Re-inject CSS into ≤ 5 docs (as flow) | Into 15–20 clone docs, each relaid out |
| Browser dependency | Needs Multicol L2 (`column-height`, `column-wrap`) in WebView2 | Multicol L1 only (works on any Chromium) |
| Code size (estimate) | ≈ FlowRenderer + 500 lines of grid helpers | ≈ 2 × that, plus a clone/recycle subsystem |

### Is candidate A available in the shipping WebView2?

To the best of my knowledge, Chromium implemented `column-height` and `column-wrap` (CSS Multicol Level 2 "row wrapping") and shipped them in stable around **Chrome/Edge 145 (early 2026)**. WebView2 Evergreen tracks Edge stable, so a current Windows 11 runtime (Nov 2026) should have them. **I have not verified this on the reference machine.** This spike could not read the installed WebView2 runtime version (that needs a permission I did not have) and did not run the app. That is measurement **G0** below.

So the code never relies on that assumption. `grid/gridSupport.ts` decides at runtime in two steps, cached per document:

1. `CSS.supports('column-wrap', 'wrap') && CSS.supports('column-height', '40px')`: cheap. False on engines that do not parse the properties.
2. **Layout probe:** a tiny, hidden, wrapped multicol (4 lines per 40 px column, 2 columns per row, 20 px `row-gap`) in the app document. It checks that column 2 is at (110, 0), that column 3 has **wrapped** to (0, 60), and that the container grew to hold all 3 rows. Parsing a property does not prove the layout implements it. The probe also confirms that `row-gap` applies between wrapped rows, which the row geometry depends on.

`createRenderer` uses the result. If unsupported → FlowRenderer (one page) with `fallback: 'grid-unsupported'` and a `console.warn` carrying the reason. ReaderView should show a notice ("Two-page view needs a newer WebView2; showing one page") and **keep** the user's setting, so it takes effect once the runtime updates.

## Decision

**Candidate A, with the runtime feature check plus layout probe, falling back to one-page FlowRenderer.**

Why:

1. **It reuses ADR-001 almost entirely.** Every section is still one auto-height, sandboxed iframe in a vertical track. Section heights are whole multiples of the viewport, so slots, virtualization (≤ 5 mounted), height estimation, anchoring, key/wheel forwarding, link handling and locator resolution all carry over. Most of it is imported from `flow/*`, not rewritten.
2. **Cost and frame time.** One layout per section, with no clone recycling on the scroll path. B multiplies layout and memory by 3–4 and adds main-thread work while the user holds ↓ (§11: ≥ 99 % frames on time, no long task > 50 ms).
3. **Correctness.** One document per section keeps caret hit-testing, text selection, CFI and char offsets exactly as in flow. B splits a chapter's visible text across several documents.
4. **The dependency risk is bounded.** The mode is opt-in (FR-LM-0), the runtime is evergreen, the check is honest (it tests behaviour, not just parsing), and the fallback is the default reading mode, which is fully functional. If G0 shows the probe failing on the owner's machine, B is the documented plan. It slots into the same `GridSlots` interface (a slot holding row-window clones instead of one iframe).

## Design (as built)

```
mount el
└─ div.er-grid               scroll container, overflow-y auto, overflow-anchor none (manual anchoring), desk colour
   └─ div.er-grid-track
      ├─ div.er-grid-slot[0]  height = rows₀ × H, background = page colour
      │   ├─ iframe            absolute at x = frameLeft, width = 2·textW + colGap, height = rows₀ × H
      │   │   └─ <html>        wrapped multicol: column-count 2, column-height textH, row-gap 2·marginY,
      │   │                    padding-block marginY → row r spans [r·H, (r+1)·H)
      │   └─ div.er-grid-edges overlay: desk gutter between pages, side strips, 1 px hairline every H
      ├─ div.er-grid-slot[1]  (spacer of remembered / estimated rows when unmounted)
      └─ …
```

| Concern | Choice | Module |
| --- | --- | --- |
| Geometry | `H` = viewport height = row pitch = page height. `pageW = ⌊(W − gap)/2⌋`. Text column = `min(pageW − 2·marginX, maxLineWidth)` (≥ 160 px), centred in its page. `textH = H − 2·marginY` (marginY shrinks if `textH` would drop below 48 px). `colGap = pageW − textW + gap`, so the right page's text starts exactly at its page inset. | `grid/gridMath.ts` |
| Section CSS | `frameBaseCss` (flow) + root overrides. **Specificity:** compileStyle forces `html, body, body * { column-count: 1 !important }` and its `<style id="er-style">` must stay last (§10.4 step 3). For `!important` from the same origin, higher specificity wins whatever the order, so the grid uses `:root:root` (0,2,0) and `:root > body`, `:root body *` (0,1,1). Descendants are reset to `column-count: auto`, so they are not nested 1-column multicol containers. Media fit one page of text (`max-height: textH`, `break-inside: avoid`). `column-fill: auto` (the last row fills left first; no balancing). | `grid/gridCss.ts` |
| New row per chapter | Automatic: each section is its own iframe and every slot is a whole number of rows, so a chapter's last row may have an empty right page. | `grid/gridSlots.ts` |
| Heights | Measured `documentElement` height → `rows = ⌈(h − 1)/H⌉` (≥ 1). Estimates use the flow prior converted to grid px (`flowPx × H / (2·textH)`) through the same `HeightEstimator`, snapped up to whole rows. So every correction is a multiple of `H`, and an aligned view stays aligned. | `grid/gridMath.ts`, `grid/gridSlots.ts` |
| Virtualization | Same policy and helpers as flow (`selectWindow` / `planMounts`, radius 1, or 2 when fast, ≤ 5 mounted, pinned during navigation). Rows inside a mounted section are not virtualized; Chromium culls off-screen paint. | `flow/slotWindow.ts`, `grid/gridParts.ts` |
| Anchoring | Manual only (`overflow-anchor: none`, as flow's current default after the scroll-feel audit). **Row-relative:** the anchor is the *row* holding the text anchor, not its line. A reflow that only moves the text to the other page of the same row does not scroll. Because row quantization hides many reflows (a font load that keeps the row count), every content resize re-checks whether the anchor text changed rows. | `grid/gridSlots.ts` (`#commit`) |
| Locator | First visible character **in reading order**: the topmost visible row's **left page**, at the first line in view. If the left page's text has scrolled out except for less than half a line, the next row's left page is used. Found by caret hit-testing at (1 em, probe y). The fallback is a bisection on a **reading key** (page index × H + y within the page). Raw `y` restarts at the top of the right page, so flow's bisection cannot be reused; the reading key is monotonic in document order. `charOffset`, `snippet`, `cfi` and `progress` come from flow's `locatorOf` / `LocatorBridge`, so they mean the same in both modes. | `grid/gridAnchor.ts` |
| Restore (goTo, mount, setStyle, resize) | **Row-aligned:** the row containing the target character goes to the viewport top, so a whole spread is visible. Placements come from flow's `locatorAttempts` / `hrefPlacement` (cfi → charOffset+snippet → globalCharOffset → progress), wrapped by `rowAligned`. | `grid/gridAnchor.ts` |
| Sticky locator (drift ≤ 1 line) | A spread shows up to two pages, so "first visible character of the row" can be up to two pages **before** the character we navigated to. Re-saving that would drift on every flow → grid → flow switch. So the exact target character is kept as a *sticky* anchor. While its row is still at the viewport top, `getLocator()` and `relocate` report it, and setStyle/resize re-place it. Scrolling away makes the locator the computed first visible character again. Result: a restore followed by `getLocator()` is lossless, and repeated mode switches or font changes do not accumulate drift. | `PageGridRenderer` (`#anchor`, `#restore`, `#navigate`) |
| Paging | `page(±1)` = exactly one row = `H`, with no overlap lines (`setPageOverlapLines` is a no-op). It uses the same `ScrollAnimation` easing and reduced-motion handling as FlowRenderer's current `page()`. There is no snapping: from an unaligned position, PgDn keeps the offset (as in Word), and no content is skipped. | `grid/gridMath.ts` (`gridPageStep`) |
| Home/End | First row of the section, or its last row (the final spread fully in view). | `grid/gridMath.ts` (`sectionEdgeY`) |
| Scroll API | Same as FlowRenderer: `scrollBy` (sub-pixel remainder via `ScrollPosition`), `getScrollTop`, `setScrollTop`, `getMaxScroll`, `getViewportHeight`, `getLineHeight`, `scrollElement`, `sectionCount`, `getSectionIndex`, `goToSectionEdge`, `cancelScrollAnimation`, `debugStats()`, plus `getRowHeight()`. The `ScrollRenderer` interface in `createRenderer.ts` names this shared surface. | `PageGridRenderer.ts`, `createRenderer.ts` |
| Keys, wheel, links | Identical to flow (`flow/eventForward.ts`, `SectionFrame` listeners, `resolveLink`). `isForwardedEvent` recognizes clones from either renderer (same WeakSet). | |
| Page edges (minimal; M6.2 polishes) | The scroller and gutter use the desk colour (`color-mix(fg 9 %, bg)`); pages use the reading background, with a 1 px hairline between rows. These are drawn by a `pointer-events: none` overlay **above** the iframe. They are not drawn through a transparent iframe: the app shell is `color-scheme: dark`, so Chromium would paint an opaque backdrop behind a mismatched iframe document. | `grid/gridSlots.ts` (`#paintEdges`) |

### Reused from `flow/*` (imported, not forked)

`SectionFrame`, `frameBaseCss`, `forwardKey`/`forwardCtrlWheel`/`isForwardedEvent`, `SlotLayout`, `HeightEstimator`/`priorPxPerUnit`/`rescaleHeight`, `selectWindow`/`planMounts`, `anchorCorrection`, `ScrollVelocity`, `clamp`, `ScrollPosition`, `locatorAttempts`/`offsetPlacement`/`hrefPlacement`/`locatorOf`/`textAnchorOf`, and `rangeTop`/`rangeAtOffset`/`caretAt` plus the `textOffsets` definitions. `ScrollAnimation` comes from `input/`.

Two small changes to flow helpers were needed, both type- and export-only, with no behaviour change for FlowRenderer:
- `flow/flowAnchor.ts`: `locatorOf(slots: Pick<FlowSlots, 'frameAt'>, …)`, widened from `FlowSlots` so GridSlots can pass itself.
- `flow/sectionText.ts`: `caretAt` is now exported (it was module-private) instead of being copied.

`flow/flowSlots.ts` was **not** reused or edited. Separators, flow geometry and line-relative anchoring are wired into it, and it is being changed for scroll feel right now. `grid/gridSlots.ts` mirrors its structure. A shared base class is a follow-up once the scroll-feel work lands (see Q5).

### Deviations from the PRD (recorded here per §13)

1. **PgDn easing:** FR-LM-5 says "instantly". FlowRenderer's `page()` now uses a 200 ms ease-out (`ScrollAnimation`, scroll-feel work in progress). The grid matches FlowRenderer so the two modes feel the same, with reduced motion still instant. Whatever is decided for flow should apply to both.
2. **Rows tile exactly:** pages are exactly `H` tall with no desk gap between rows (only a hairline), because a visible gap would make "one row per PgDn" leave a gap at the viewport top. The vertical page margin (`layout.marginY`) separates rows visually.
3. **`layout.pageGap` is not in `CompiledStyle`:** it is a renderer option (`pageGapPx`, default 48) until `CompiledStyle` gains `pageGapPx`. The renderer already reads it from the style if present (proposal Q2).
4. **`layout.minSpreadWidthPx`** is not applied in scroll + 2. The PRD defines that fallback only for paged flow (FR-LM-3). Below about 2 × (160 + 2·marginX) + gap, pages get narrow but still hold one column each (Q3).

## Risks

| # | Risk | Mitigation / status |
| --- | --- | --- |
| G-R1 | `column-wrap` / `column-height` are missing or buggy in the installed WebView2. | The runtime check is behaviour-based (layout probe). Fallback: one-page flow plus a notice. **G0 measures it.** If it fails on the owner's machine, build candidate B behind the same factory. |
| G-R2 | **Monolithic content taller than a page** (a large table, `<pre>`, an SVG without intrinsic size, a block with publisher `break-inside: avoid`) overflows its column into the row gap or the next row and overlaps text. | Media are capped to `textH` with `break-inside: avoid`. Other monolithic blocks are a known limit of all paginated readers. Measure G9. If needed, a follow-up rule `:root body * { break-inside: auto !important }` (except media) at the cost of publisher intent. |
| G-R3 | **Long task when a large chapter mounts**: a fragmented (multicol) layout of a 50,000-char section costs more than a single-column one. | Neighbours mount ahead (radius 1, or 2 when fast), as in flow. **Measure G2.** Fallback: lower the fast-scroll radius, or split the mount (load hidden, then show). |
| G-R4 | Caret hit-testing inside fragmented content returns an unexpected position (Chromium hit-tests per fragment). | It is validated (the line must be near the probe and in the left column). Otherwise the reading-key bisection is used, which reads only client rects. Covered by G4. |
| G-R5 | The sticky locator hides a real move (the user scrolls away and back to exactly the same aligned offset). | Intended: the same view reports the same locator. Any other offset reports the computed first visible character. |
| G-R6 | `vh`-sized publisher content: the iframe viewport is `rows × H` tall, so `100vh` grows with each row (the same feedback loop as ADR-001 R4). | Same guard: `SectionFrame` freezes after > 24 resizes/s. epubSource should apply foliate's vh→px transform (ADR-001 R4). |
| G-R7 | **compileStyle's forced `column-count: 1 !important` on `html, body` will also break PaginatorRenderer (M6.1).** foliate-js sets its columns as **inline styles without `!important`** on the root, which lose to an `!important` stylesheet rule. | Not a grid problem (the grid out-specifies it). Recorded for M6.1; see Q4. |
| G-R8 | Track height exceeds Chromium's ~33.5 M px layout limit. | Grid track ≈ flow track × (flow column / 2·textW) × (H / textH), plus the last-row padding of each chapter. On wide screens it is usually shorter than the flow track. Same mitigation as ADR-001 R6. |

## Measurements (to run in-app; numbers TODO for Dany_PM)

Use a release build on the reference machine (§11), a temp profile (`npm run dev:test` / `.test-profile/…`), the 3 sample EPUBs and the 10 MB GB18030 TXT. Read `renderer.debugStats()` (geometry, mounted, anchoring, sticky) and `detectGridSupport()` from the devtools console.

| # | What | How | Target | Result |
| --- | --- | --- | --- | --- |
| G0 | **Runtime support** on the owner's WebView2 | `navigator.userAgent` (the `Edg/` version) and `detectGridSupport()` in the app's devtools | `{ supported: true, reason: 'ok' }`; record the version | TODO |
| G1 | FPS holding ↓ (720 px/s, acceleration on) across ≥ 3 chapter boundaries, two pages | rAF frame logger; count frames > 1.5 × vsync | ≥ 99 % on time at 60/120/144 Hz | TODO |
| G2 | Long tasks when a 50,000-char chapter mounts (grid vs flow) | `PerformanceObserver('longtask')`; time from `ensureMounted` to ready | none > 50 ms on the scroll path; record the mount ms for grid and flow | TODO |
| G3 | PgDn = one row | From an aligned row, press PgDn 10× | each press moves exactly `getRowHeight()` = viewport height; a full spread is visible after each | TODO |
| G4 | Locator round-trip | 50 automated flow → grid → flow switches at random positions (M6.3 harness) | drift ≤ 1 line; `debugStats().sticky === true` right after each switch | TODO |
| G5 | Style change 20 → 28 px in a 50,000-char chapter | time setStyle → paint; target character visible in the top row | < 150 ms; locator unchanged (sticky) | TODO |
| G6 | Resize 1280 → 3440 → 1000 px wide, and the height | drift; text column per page; row alignment | drift ≤ 1 line; exactly one column per page; `scrollTop` a multiple of the row at rest | TODO |
| G7 | Jump on prepend: scroll up into the previous chapter (estimated → measured) | watch a marked line; `debugStats().anchoring.lastResidualPx` | no visible jump; corrections are multiples of the row height | TODO |
| G8 | Memory with 5 sections mounted, grid vs flow | Task Manager working set (WebView2 processes) | < 350 MB with the 10 MB TXT | TODO |
| G9 | Oversized content: a chapter with a tall table / `<pre>` / figure | visual | no overlap into the next row (else apply the G-R2 follow-up) | TODO |
| G10 | Mode switch time, one page ⇄ two pages | `performance.now()` from the `D` keypress to the first frame of the new renderer | < 500 ms; drift ≤ 1 line | TODO |

**Go/no-go:** go if G0, G1, G3, G4 and G7 pass. If G0 fails, decide between shipping two-page scroll as "unavailable on this WebView2" (the setting stays, the fallback notice shows) and building candidate B.

## How to wire it (for Dany_PM; ReaderView.tsx and `input/**` are not touched by this chunk)

1. Hold the renderer as the shared type: `let renderer: ScrollRenderer | undefined;` with `import { createRenderer, type ScrollRenderer } from '../../engine/renderers/createRenderer'`.
2. Replace `new FlowRenderer({...})` with:
   ```ts
   const created = createRenderer(
     { flow: 'scroll', pagesPerView: settings.reader.pagesPerView },   // contract default 1
     {
       locatorBridge: createLocatorBridge(source.sections.length),
       pageOverlapLines: scrollSettings.pageOverlapLines,
       pageGapPx: style.layout.pageGap,
     },
   );
   renderer = created.renderer;
   if (created.fallback === 'grid-unsupported') notify('Two-page view needs a newer WebView2. Showing one page.');
   ```
   `new SmoothScroller(renderer, …)` and every `renderer.*` call in ReaderView already type-check against `ScrollRenderer`.
3. **`D` toggle** (owner-initiated only; never automatic; never restored on a fresh profile): `scroller.stop()` → `const at = renderer.getLocator()` → unsubscribe the renderer's `on(...)` listeners → `renderer.destroy()` (it removes its own scroller element and unloads its sections; **keep `source` alive**) → `createRenderer({ flow: 'scroll', pagesPerView: next }, sameOptions)` → re-subscribe `relocate` → `await renderer.mount(host, source, compileStyle(style), at)` → build a new `SmoothScroller(renderer, …)` (it holds its target) → persist `reader.pagesPerView`. The key router closure reads `renderer` through the effect variable, so reassigning it is enough.

## Open questions

- **Q1 (Dany_PM, G0):** confirm the WebView2 runtime version on the owner's PC and `detectGridSupport()`. If it is unsupported: notice only, or build candidate B?
- **Q2 (contract / style lane):** add `pageGapPx: number` (`layout.pageGap`) to `CompiledStyle` (`src/engine/style/types.ts`) and to compileStyle's output. PageGridRenderer already prefers it over the option. No `contract/` change is needed: `layout.pageGap` already exists in the settings schema.
- **Q3 (owner):** should scroll + 2 also fall back to one page below `layout.minSpreadWidthPx` (as paged does, FR-LM-3)? Today it keeps two narrow pages. If yes, `createRenderer` gains a `viewportWidth` input and the resize path switches renderers.
- **Q4 (M6.1):** compileStyle's `html, body, body * { column-count: 1 !important }` will override foliate-js's inline root columns in PaginatorRenderer. Proposal: scope the forced single column to `body *` only (descendants), and let each renderer own the root (flow: `frameBaseCss`; grid: `gridCss`; paginator: foliate). That needs a snapshot update in `compileStyle.test.ts`.
- **Q5 (after the scroll-feel work lands):** extract a shared `SlotTrack` base from `FlowSlots`/`GridSlots` (mount/unmount, estimation, commit). They differ only in geometry, CSS and the anchor quantum (line vs row), and today's mirror costs ~250 duplicated lines.
- **Q6 (owner, cosmetic, M6.2):** should PgDn from an unaligned position snap to the next row boundary (stricter "pages") instead of moving exactly one viewport (Word)? Today it moves exactly one viewport.
