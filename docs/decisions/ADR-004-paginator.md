# ADR-004: PaginatorRenderer (paged flow, one page or an opt-in spread)

- Status: **Accepted (implemented, jsdom-tested). In-app visual check at 3440 px pending.** Partly superseded by ADR-005 (2026-11-11): turns now slide (~180 ms) instead of being instant, and two pages are a horizontal filmstrip that moves one page per step. Pagination, locator and fallback rules below still apply.
- Date: 2026-11-10
- Chunks: M6.1 (PaginatorRenderer), M6.2 polish (desk/edges), narrow-window fallback (PM decision)
- Author: Claude Code (renderer lane). Decision owner: Dany_PM.
- PRD: FR-LM-0/3/4, §6.6 (page turn: none, instant), §6.7, §10.3, §10.4 steps 2 and 6. Stories: LM-03, LM-04, LM-05, LM-07.

## Decision

Use **our own column pagination**, not foliate-js's `paginator.js`. The reasons:

1. foliate's `View` sets `sandbox="allow-same-origin allow-scripts"` on every section iframe (paginator.js:244). PRD §10.4 step 2 forbids `allow-scripts`, and we cannot change vendor code.
2. foliate animates turns, waits `wait(100)` on section changes, and uses its own locator and anchoring code. We already have tested pieces for all of this: `SectionFrame`, flow locators (`flowAnchor`), sticky anchors, link and key forwarding.

## Mechanism (`src/engine/renderers/PaginatorRenderer.ts`, `paged/*`)

- **One iframe per section.** Its root is a horizontal multicol container of fixed size: `width = frameW`, `height = textH`, `column-count = cols`, `column-width = textW`, `column-fill: auto` (`paged/pagedCss.ts`). These rules use `:root:root` specificity, so they beat compileStyle's forced `column-count: 1`, which still keeps every descendant at one column. The root width is fixed in CSS, so widening the iframe never changes the column width.
- **One page = one column at every width.** One page has `cols = 1` and `frameW = textW`, which is `min(viewport − 2·marginX, maxLineWidth)` centred. A 3440 px window gets one centred column (tests cover 480–5120 px). A spread has `cols = 2`, and its column gap is both page insets plus `layout.pageGap`.
- **Instant turns.** The iframe is widened to hold every column. It sits in a clip box and is shifted by `translateX(−spread·cols·pitch)`. A page turn is one style write: no transition, no rAF, no timer. The neighbouring sections (±1) stay mounted and measured, so crossing a chapter is also synchronous. The column count comes from the bounding rect of the body's contents, and is re-measured on font/image reflow (`ResizeObserver` on `body` plus capture of `load`) and before a forward turn on the last spread.
- **Locator.** The locator is the first visible character, at the top of the spread's first column: a caret hit-test, then a bisection on a (column, y) key. The bisection reuses `grid/gridAnchor.bisectByKey`. Navigation and restores keep the exact target character "sticky" while its spread is shown. That makes resize, setStyle and mode switches lossless, as in ADR-002.
- **Same API as the scroll renderers (`ScrollRenderer`).** `page(±1)` turns a spread. `scrollBy(px)` turns one page in the sign's direction. `getScrollTop()` and `getMaxScroll()` both return 0, so ReaderView's smoothScroller calls `scrollBy` exactly once per ArrowUp/Down press: scroll.down/up = next/prev page with no ReaderView change. `goToSectionEdge` goes to the first or last spread. The renderer also handles the wheel (one turn per gesture) and click zones (left/right thirds; it ignores links and text selections).
- **Desk.** `grid/deskColors.ts` is shared with PageGrid (§6.7). The page uses the theme background. The desk is the background mixed 4 % toward black (dark themes) or toward the text colour (light themes). Page edges are 1 px at 6 % text colour, and the gutter is `layout.pageGap`. Paged one-page has no desk.

## Narrow-window fallback (both two-page renderers)

When the requested pages-per-view is 2 and the reader viewport is narrower than `layout.minSpreadWidthPx` (default 1000), the renderer shows one page. It returns to two once the viewport is at least that wide. PageGrid rows then hold one page each (same wrapped-multicol path with `column-count: 1`). The saved preference is never changed, and a request for one page never shows two (`effectivePages`). The renderers report the effective value with the `spread` event `{ pagesPerView, requested }` (sent after mount and on every change) and with `getEffectivePagesPerView()`. `setMinSpreadWidth(px)` applies a settings change live.

## Verification

- jsdom (`PaginatorRenderer.test.ts`, `paged/pagedMath.test.ts`, `PageGridRenderer.spread.test.ts`, `grid/deskColors.test.ts`): one column at 480–5120 px including 3440; spread fallback below `minSpreadWidthPx` and recovery; one-page profiles never show two pages; synchronous turns with no rAF or timers; one page per smoothScroller press; wheel and click zones; **0-character locator drift across 50 random switches** (remount 1↔2, width 800–3440, font 16–28). These tests use a chars-per-column layout model, because jsdom has no layout.
- Needs the real app (WebView2): the on-screen column count at 3440 px; caret hit-testing at column tops; huge sections (the iframe width is `spreads·cols·pitch`, the same order of size as foliate's); image/font reflow timing; Flow↔Paged switch drift measured in lines.

## Consequences

- ReaderView only needs to pass `minSpreadWidthPx` to `createRenderer` and may show the `spread` event. The M key just changes `reader.flow`, and the existing replaceLayout path does the rest.
- PRD §10.3 says `scrollBy` is a "no-op for Paginator". Here it turns one page instead, which is what makes the smoothScroller path work. The `Renderer.ts` doc comment records this deviation.
