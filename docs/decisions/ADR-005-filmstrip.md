# ADR-005: Two-page filmstrip and animated page turns

- Status: **Accepted (implemented, jsdom-tested). On-screen check by Dany_PM pending.**
- Date: 2026-11-11
- Owner feedback: t20u #5 (page turn animated), #6 (two pages move horizontally), #2 renderer side (relayout on F11 / maximize / resize).
- Author: Claude Code (renderer lane). Decision owner: Dany_PM.
- Supersedes: ADR-002 (vertical rows of two pages) as the renderer for two pages; ADR-004 "Instant turns" (paged + 1 now slides). ADR-004's pagination, locator and fallback rules still apply.

## Decision

1. **One renderer for every page layout.** `PaginatorRenderer` renders paged + 1 and **both** flows with two pages (`createRenderer`: kind `'paged'` or `'filmstrip'`). `reader.flow` only decides whether left/right-third clicks turn pages (paged) or not (scroll). No setting and no contract change: `reader.flow` and `reader.pagesPerView` keep their values and meaning ("two pages" now looks like a filmstrip). `PageGridRenderer` is no longer chosen; it stays in the tree until the filmstrip is signed off, so a revert is one line in `chooseRenderer`.
2. **Filmstrip.** Two pages side by side, each one screen tall. Every advance moves **one page**: the left page slides out to the left, the right page moves into the left slot, the next page enters on the right. Back is the reverse.
3. **Chapter boundaries: side by side.** A chapter's last page and the next chapter's first page can share the view (no blank page, no forced left start). This keeps every step exactly one page. At the book end the last page rests in the right slot.
4. **Motion.** Transform-only ease-out, 180 ms per step (`STEP_MS`), the same finite curve as the arrow-key glide and PgDn in scroll flow (`input/scrollAnimation.ts`). A new step while one runs finishes it instantly (the view never trails its target by more than one page), so rapid presses never queue lag. `prefers-reduced-motion: reduce` = instant (the app has no own reduced-motion setting). Paged + 1 uses the same slide (next = slides left, prev = slides right).

## Mechanism

- **One strip of columns** (`paged/stripMath.ts`). Mounted, measured sections sit end to end; positions are in columns relative to a *base* section (the left page's section), so nothing depends on unmounted sections. `stripBounds` gives where the left page may rest; `locateColumn` maps a strip column to (section, column).
- **Frames** (`paged/pagedFrames.ts`). One iframe per mounted section (ADR-004 multicol), each translated to its strip position; sections outside the view are `visibility: hidden`. Two pages: the clip spans the full width (pages slide in from / out to the window edges) and a paper layer (page rectangles, 1 px edges, desk gutter from `grid/deskColors.ts`) moves with the strip modulo one pitch. The visible sections plus one neighbour on each side stay mounted, so crossing a chapter is still only transforms.
- **Motion** (`paged/stripMotion.ts`): position `x` eases toward `target`; `to()` keeps the current speed when it is faster than a fresh ease-out (held input retargets every frame and so moves continuously); lag cap = one pitch; reduced motion = jump. When the left page crosses into another section the strip is rebased (`shift`) without disturbing the motion, and `section` is emitted.
- **Input.**
  - `page(±1)` (PgDn/PgUp/Space/ArrowLeft/Right, click zones, auto-scroll): one page step.
  - Held keys: the smoothScroller calls `holdStart(dir)` on press and `holdEnd()` when the held motion stops. Paged + 1: one page per press (`scrollBy` ignored in between; `getMaxScroll() = 0`). Filmstrip: the press takes one page, then the smoothScroller's held travel (`scrollBy(px)`, arrow speed with its acceleration) moves the strip continuously; on release it settles on the nearest page boundary that is not behind what is already on screen. The filmstrip reports a virtual scroll range whose edges are the book's edges, so the smoothScroller stops there.
  - ReaderView hook (one condition): for renderers with `turnsPages`, `page.next/prev` are routed through the smoothScroller like `scroll.down/up`, so a held PgDn/Space/ArrowRight glides the filmstrip too (paged + 1: unchanged, one page per press).
  - Wheel (filmstrip): a discrete event (line/page delta mode, or >= 20 px after a 40 ms pause: a mouse-wheel notch) is one page step; a streaming gesture (touchpad, fast-spun wheel) moves the strip with its travel and settles on a page boundary after 160 ms of quiet. Paged + 1 keeps one page per wheel gesture.
  - Auto-scroll: `turnsPages` makes the AutoScroller turn one page every viewport height of travel in both flows.
- **Locator.** The first visible character of the left page (ADR-004 hit-test + bisection). The step target is known at once, so `getLocator()` is the destination even mid-slide; `relocate` fires when the view comes to rest. Navigation/restores keep the exact target character sticky while it is on a shown page.
- **Resize / F11 / maximize / font / 1↔2 pages.** `ResizeObserver` → one relayout per frame: capture the anchor (sticky character, else the left page's first character) at the rest/target column, stop a running slide, apply geometry, re-measure, show the page holding the anchor. A slide in progress lands on its target page; a held key keeps going from the relaid-out page. The narrow-window fallback (one page below `layout.minSpreadWidthPx`, two again when wide) is part of the same relayout. FlowRenderer already does capture → relayout → restore per frame, reusing the first anchor for a 200 ms burst.

## Verification

- jsdom: `PaginatorRenderer.test.ts` (slide timing and direction, rapid turns, reduced motion, chapter crossing, held key continuous + settle with no back-bounce, taps, wheel notches at any cadence, touchpad swipe = one page, auto-scroll, Home/End/Ctrl+Home/End, goTo, narrow fallback, **0-character drift over 60 random switches including mid-slide**, 1280×720 ↔ 1920×1080 round trips in 1 and 2 pages, resize mid-slide and mid-hold, maximize/restore across the fallback), `FlowRenderer.resize.test.ts`, `paged/stripMath.test.ts`, `paged/stripMotion.test.ts`, `createRenderer.test.ts`.
- Needs the real app (WebView2): how the slide looks at 60/120 Hz; the paper layer and gutter alignment with the text columns while moving; touchpad vs mouse-wheel classification on the owner's hardware; F11 / maximize relayout timing.

## Consequences

- `Renderer.scrollBy` in the paginator is held-key travel between `holdStart`/`holdEnd` (documented in `Renderer.ts`). `cancelScrollAnimation()` is a no-op there: a step always ends on a page.
- Very fast held input can reach the edge of the loaded strip before the next section is mounted; the strip then waits at that page (the right slot can be an empty page for the length of a section load) and continues once it is ready.
