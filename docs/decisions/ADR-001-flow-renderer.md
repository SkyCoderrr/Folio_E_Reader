# ADR-001: FlowRenderer (continuous single-column scroll)

- Status: **Accepted as a prototype. Go/no-go waits on the in-app measurements below.**
- Date: 2026-11-09
- Chunks: M0.4 (Spike A), folded into M1.3 (FlowRenderer v1)
- Author: Claude Code (UI lane). Decision owner: Dany_PM.
- PRD: §5.2 (FR-LM-0/1/4/5), §6.6, §8.2–8.3, §9.4, §10.1, §10.3, §10.4, §11, §13. Stories: LM-01, LM-06, KB-02…KB-04.

## Context

The default layout (scroll flow, one page) must read as one continuous, centred column across chapter boundaries. There must be no swap, reload flash or position reset. It must hold at most 5 chapters in memory, keep exactly one text column at any width, and preserve the locator through style changes and resizes. §10.1 assumed that foliate-js's `scrolled` flow shows one section at a time, and left that to this spike to confirm.

## Finding: foliate-js scrolled mode is not usable for this (confirmed from source)

These come from `vendor/foliate-js/paginator.js`, at the submodule pin Dany_PM added in 78914ae:

1. **One section at a time.** `Paginator` holds a single `#view`, and each `View` owns one `<iframe>`. `#createView()` destroys the previous view and removes its element before it creates the new one. `#goTo()` to a different index loads the new section and calls `sections[oldIndex].unload()`.
2. **Chapter ends swap the content instead of flowing on.** In scrolled flow, `#scrollNext()` returns `true` once `viewSize - end <= 2`. `#turnPage()` then calls `#goTo({ index: adjacentIndex, anchor: () => 0 })`, which replaces the iframe and puts the new chapter at its top. Native wheel scrolling just stops at the end of the chapter. Only `next()`/`prev()` cross the boundary, and they do it by swapping.
3. **Relocate is debounced by 250 ms** (`debounce(... #afterScroll('scroll'), 250)`), and there is no virtualization or scroll anchoring for content above the viewport.
4. **The iframe runs with `sandbox="allow-same-origin allow-scripts"`.** The comment cites WebKit bug 218086: event listeners don't fire without `allow-scripts`. PRD §10.4 requires no `allow-scripts`. That bug is WebKit-only, and we run on WebView2 (Chromium) only.

So we **do not** use the foliate-js paginator for scroll flow. We do borrow two of its ideas: the auto-height iframe (`View.scrolled()`/`expand()`, a ResizeObserver on the iframe document from the parent realm) and the media fitting (`setImageSize`). No code is copied. foliate-js stays the EPUB parser and the CFI library, and remains the paged-flow engine (PaginatorRenderer, later).

## Decision

Our own renderer, `src/engine/renderers/FlowRenderer.ts`, written in plain TS/DOM with no React:

```
mount el (any element with a definite height)
└─ div.er-flow            scroll container: overflow-y auto, scrollbar-gutter stable,
   │                      overflow-anchor auto, background = style.background
   └─ div.er-flow-track   padding: marginY 0
      ├─ div.er-flow-slot[0]   height = content(0)                (explicit px)
      │   └─ iframe            sandbox="allow-same-origin", centred, width = column
      ├─ div.er-flow-slot[1]   height = separator + content(1)
      │   ├─ div.er-flow-sep   chapter separator: 96 px × 1 px rule, text colour at 22 %
      │   └─ iframe | (nothing = spacer)
      └─ …
```

| Concern | Choice | Module |
| --- | --- | --- |
| Layout model | Integer heights per slot, lazy prefix sums, binary-search `indexAt`. The DOM mirrors the model exactly, so the anchoring math is exact. | `flow/slotLayout.ts` |
| Virtualization | Visible sections ±1 (±2 when scrolling faster than 3 viewports/s), capped at 5. Visible sections are never dropped. ±1 hysteresis while under the cap avoids mount/unmount thrash. Sections pinned by an in-flight navigation are never unmounted. Unmounting keeps the slot's measured height, so nothing moves. | `flow/slotWindow.ts`, `flow/flowSlots.ts` |
| Height estimation | `size × px-per-unit`. The ratio is learned from sections measured under the current style and column (size-weighted). Samples under 2,000 units, such as covers and title pages, are ignored once a real chapter has been measured, and the ratio is clamped to [prior/8, prior×8]. On a style or width change, remembered heights are rescaled by the change in the ratio, and never-measured slots are re-estimated whenever the ratio moves by more than 10 %. | `flow/heightEstimator.ts` |
| Scroll anchoring | **Native first, manual residual.** `overflow-anchor: auto` stays on. After any height change we write the new heights, read `scrollTop` back (which forces layout and includes any native adjustment), and correct only the residual, so the anchor keeps its viewport offset (`anchorCorrection`). The anchor is the slot at the viewport top. Inside that slot, a live text Range is captured on settle and after jumps, so a reflow inside the slot (an image or font loading above the reading line) is corrected too. The counters in `debugStats().anchoring` record whether native anchoring or our correction did the work. `nativeAnchoring: false` switches to manual-only for A/B testing. | `flow/flowMath.ts`, `flow/flowSlots.ts` |
| Single column | Renderer-owned `<style id="er-base">` forces `column-count/width: auto !important` on every element, makes html/body auto-height with no margins, uses horizontal writing, and fits media to the column and to one screen height. compileStyle's `<style id="er-style">` is appended after it and stays last (§10.4 step 3). | `flow/frameCss.ts` |
| Geometry ownership | The renderer owns geometry: column = min(viewport − 2·marginX, maxLineWidthPx), with a 160 px minimum. `CompiledStyle.css` carries content styling only (see `style/types.ts`). | `flow/flowMath.ts` |
| Style change | Capture the anchor, re-inject CSS into the ≤ 5 mounted docs, re-measure them synchronously, rescale and re-estimate the rest, then restore the anchor, all before the next paint. | `FlowRenderer.setStyle` |
| Resize | ResizeObserver on the scroller, coalesced to one relayout per frame. The anchor captured at the start of a resize burst is reused until 200 ms after the last resize, so repeated reflows don't drift. | `FlowRenderer.resize` |
| Locator | Caret at (content left + 1 em, viewport top + 0.5 line) via `caretPositionFromPoint` (or `caretRangeFromPoint` as fallback), checked to land on a line near the top. If it doesn't, a binary search runs over text nodes and then characters. `charOffset` = UTF-16 offset in the concatenated body Text nodes, excluding script/style/template/noscript (`textOffsets.ts`). M1.5b's locator.ts must use the same definition. `progress` is size-weighted. `cfi` and `globalCharOffset` come from an injected `LocatorBridge` (M1.5b); without one they are null. | `flow/flowAnchor.ts`, `flow/sectionText.ts`, `flow/textOffsets.ts` |
| goTo order | cfi → (sectionIndex, charOffset; the snippet re-anchors within ±4,000 chars) → globalCharOffset → progress. Only the target is mounted before the jump, so the old view stays visible and there is no blank flash. A newer navigation supersedes an older one. | `flow/flowAnchor.ts` |
| Keys / wheel | Capture-phase `keydown`/`keyup` listeners in each section doc are cloned and re-dispatched (bubbling) from the mount element, or from `keyTarget`. If the app cancels the clone, the original is cancelled too, which stops Chromium's keyboard scroll from chaining. Ctrl+wheel is forwarded from a **passive** listener. Plain wheel and touchpad scroll chain natively to the parent scroller on the compositor, so we don't make them block on the main thread. | `flow/eventForward.ts`, `flow/sectionFrame.ts` |
| Links | Click capture prevents in-iframe navigation, which would otherwise replace the slot's document. Internal links are resolved via `section.resolveHref` and passed to `goTo({href})`. External links go to `onExternalLink`. | `FlowRenderer`, `flow/sectionFrame.ts` |
| Sub-pixel scroll | `scrollBy` keeps the fractional remainder, so autoscroll at 40 px/s on a 144 Hz display (0.28 px/frame) still moves. It is always computed from the live `scrollTop`, so native anchoring adjustments are never undone. | `FlowRenderer.scrollBy` |
| Non-linear spine items | Rendered in spine order like any other section, so every href and spine index stays reachable. See open question Q2. | |

**foliate-js import path:** FlowRenderer imports nothing from foliate-js. CFI work lives behind `LocatorBridge`. For epubSource.ts and locator.ts, use relative paths (`'../../../vendor/foliate-js/epub.js'`, `'../../vendor/foliate-js/epubcfi.js'`) plus the `foliate.d.ts` typings from M0.3. An `@foliate/*` alias would need tsconfig and vite edits, which belong to the scaffolding lane, and gains nothing.

### Deviations from the PRD (recorded here per §13)

1. **Anchoring:** the PRD says "native first, manual as backup". We implement exactly that, but measure the residual after the fact rather than trying to predict whether Chromium applied an adjustment.
2. **BookSource** (`src/engine/book/BookSource.ts`): `resolveHref` may return `null` (foliate-js does), `ResolvedHref.anchor` may return `null`, and `Section.resolveHref?` is an optional extension that foliate-js already has, needed for in-book links. `linear` is a boolean, while foliate-js uses the OPF string, so epubSource maps `linear: item.linear !== 'no'`. The PaginatorRenderer adapter must map it back, because the paginator checks `linear !== 'no'`.
3. **Renderer events** are typed (`RendererEventMap`) instead of `(e: unknown) => void`. Payloads: `relocate {locator, reason}`, `section {index}`, `load {index, doc}`.
4. **`CompiledStyle`** carries geometry and metrics as numbers, and its `css` must not set html/body geometry (see `src/engine/style/types.ts`).

## Public API (what other chunks call)

`FlowRenderer implements Renderer`, plus:

| Member | For |
| --- | --- |
| `new FlowRenderer({ pageOverlapLines?, maxMounted?, locatorBridge?, keyTarget?, onExternalLink?, settleMs?, nativeAnchoring? })` | ReaderView |
| `scrollBy(px)`: immediate, fractional, clamped | smoothScroller / autoScroller, called once per rAF with the frame's delta |
| `getScrollTop()`, `setScrollTop(px)`, `getMaxScroll()`, `getViewportHeight()`, `getLineHeight()`, `scrollElement` | smoothScroller (detect the edges and stop), tap scroll (`tapLines × getLineHeight()`) |
| `page(±1)` | key router: PgDn/PgUp/Space/Shift+Space (LM-06), 200 ms ease-out |
| `goToSectionEdge(i, 'start' \| 'end')`, `getSectionIndex()`, `sectionCount` | Home/End, Ctrl+Home/End (KB-04); nearby mounted targets animate |
| `setPageOverlapLines(n)` | settings change |
| `isForwardedEvent(e)` (named export) | key router (forwarded events are untrusted clones) |
| `debugStats()` | dev perf overlay (§11): mounted sections, learned ratio, anchoring counters |

## Risks

| # | Risk | Mitigation / status |
| --- | --- | --- |
| R1 | Parent-realm listeners and the ResizeObserver might not fire on a sandboxed document without `allow-scripts` in WebView2. | Chromium runs callbacks in the realm of the callback, not the iframe, and foliate-js needs `allow-scripts` only for WebKit. **Verify in-app (M1).** Fallback: `allow-scripts` plus a CSP `script-src 'none'` on the section docs. |
| R2 | Native wheel or touchpad chaining from a sandboxed `scrolling="no"` iframe to the parent scroller. | This is standard Chromium scroll chaining (foliate-js scrolled mode relies on it). **Verify in-app.** Fallback: a non-passive wheel listener that calls `scrollBy`, at the cost of main-thread wheel. |
| R3 | **TXT sections from `asset:`/`http://asset.localhost` are cross-origin** to the app origin on Windows, so `contentDocument` is null: no style injection, no measuring. | `Section.load()` must return a same-origin `blob:` URL. txtSource fetches the cached HTML (CSP `connect-src` allows asset:) and wraps it in a Blob. The renderer logs "document not accessible" when this is violated. |
| R4 | A feedback loop from `vh` units: the iframe's viewport is its own content height, so `height: 100vh` content grows without end. | `er-base` forces auto-height html/body. The frame freezes its height after more than 24 resizes/s and logs a warning. epubSource should apply foliate's CSS transform (vw/vh → px, `-epub-` unprefixing) on `book.transformTarget`, as `Paginator.open()` does. |
| R5 | A programmatic `scrollTop` write during a native smooth wheel animation can cancel the rest of that animation, a small stall when the residual correction is non-zero. | Native anchoring first, so the residual is normally 0. Measure with `debugStats().anchoring.manualCorrections`. |
| R6 | Chromium's maximum layout size (~33.5 M px). A 10 MB TXT at 72 px font and line height 3 could exceed it. | Out of range for normal settings (a 10 MB TXT at 20 px is ≈ 3.4 M px). If it is ever hit, a later version compresses the coordinates of distant spacers. |
| R7 | Estimate error makes the scrollbar thumb jump as sections are measured. | The learned ratio converges after the first chapter. Anchoring keeps the text still; only the thumb moves. |
| R8 | A long task (> 50 ms) when a large chapter mounts during held-arrow scrolling (§11). | Neighbours are mounted ahead (±1, ±2 when fast). Measure. Fallback: `content-visibility: auto` inside large section docs. |
| R9 | Vertical-writing (vertical-rl) books are forced horizontal in scroll flow. | Accepted for v1. The PRD has no vertical-writing requirement. |

## Measurements (to run in-app; numbers TODO for Dany_PM)

Run these on a release build on the reference machine (§11), with a temp profile, against the 3 sample EPUBs and the 10 MB GB18030 TXT. Use `debugStats()` and the dev perf overlay (`Ctrl+Shift+P`).

| # | What | How | Target | Result |
| --- | --- | --- | --- | --- |
| M1 | FPS while holding ↓ (720 px/s, acceleration on), crossing at least 3 chapter boundaries | Performance panel or a rAF frame logger. Count frames > 1.5 × the vsync interval | ≥ 99 % of frames on time at 60/120/144 Hz | TODO |
| M2 | Long tasks while arrow-scrolling | `PerformanceObserver('longtask')` | none > 50 ms | TODO |
| M3 | **Jump on prepend:** scroll up into the previous chapter, which mounts above and changes from estimated to measured height | Record the viewport y of a marked line before and after (screen capture, or log `anchorCorrection` before/after) | 0 px visible jump | TODO |
| M4 | Native vs manual anchoring split | `debugStats().anchoring` after M3: `nativeHandled`, `manualCorrections`, `lastResidualPx`. Repeat with `nativeAnchoring: false` | Correct in both modes. Note which mode does the work | TODO |
| M5 | Wheel or touchpad over iframe text scrolls the book (R2) | Manual | Works, smooth | TODO |
| M6 | Keys with focus inside a section (R1): click text, then ↓, PgDn, `T` | Manual | Router receives them, no double scroll | TODO |
| M7 | Style change: font 20 → 28 px in a 50,000-char chapter | Time from setStyle to paint, plus locator drift | < 150 ms, drift ≤ 1 line | TODO |
| M8 | Resize 1280 → 3440 → 480 px wide | Drift, and one column at every width | Drift ≤ 1 line, one column | TODO |
| M9 | Mounted count during fast scroll | `debugStats().mounted.length` | ≤ 5 | TODO |
| M10 | Open at a saved locator (5 MB EPUB) | Time to first text at the position | < 800 ms | TODO |

**Go/no-go:** go if M1–M3, M5 and M6 pass. If R1 or R2 fails, apply the fallback listed in that row. If M3 shows a visible jump in both anchoring modes, investigate before M1.4.

## Open questions

- Q1 (Dany_PM / Codex): txtSource must return same-origin `blob:` URLs (R3). Does Codex agree, or should the Rust side serve TXT sections another way?
- Q2 (owner question 4, resolved 2026-11-10): no special handling for non-linear sections. All sections stay in normal spine order. No notes features.
- Q3 (Codex, M1.4): the smoothScroller should stop on `document.visibilitychange` and on the boss-key events, **not** on `window` `blur`. Clicking into a section iframe fires a parent `window` `blur` even though the app still has focus. `document.hasFocus()` stays true in that case.
- Q4 (owner question 5, resolved 2026-11-10): remove next/previous section shortcuts entirely, including the action IDs and alternate Ctrl+Page bindings. Home/End remains.

## Scroll feel (2026-11-10)

Owner feedback t11u/t12u makes tap easing and animated scroll-flow paging required. Snap Layouts hover check: owner says **not important, not a blocker** (also recorded in ADR-003). This does not claim the hover flyout was verified.

### Root-cause audit and tuning

| Item | Finding and change |
| --- | --- |
| SmoothScroller physics | Confirmed cause: taps under 120 ms called one `scrollBy(remaining)` followed by `stop()`. PM's release baseline has a 91 px final jump. Now keyup schedules a 200 ms glide; it never writes position synchronously. At a 60 ms tap the total duration is about 260 ms. The remaining displacement includes movement already delivered and the unpainted keydown interval. |
| Tap curve | Velocity in normalized time is `(1-t)^2 * (a+b*t)`, with `a = initialVelocity * durationSeconds`, clamped to the monotone range, and `b = 12*distance - 4*a`. Its exact integral delivers the remaining distance; velocity and acceleration reach zero, with no overshoot or spring snap-back. This preserves release velocity while allowing one smooth peak. |
| Held arrows | Retain arrowSpeed, startRampMs, acceleration, accelMax, accelRampMs and stopDecelMs. Midpoint integration uses intervals no longer than 2 ms. Defaults remain 720 px/s, 80 ms start ramp, 2.5x acceleration over 800 ms, and 100 ms release. Release integrates a finite quadratic velocity ease-out (distance = velocity * stopDecelMs / 3000). OS repeat contributes no movement. |
| Page and edge movement | 200 ms ease-out-cubic, same `pageStep(viewport, lineHeight, overlapLines)` target (baseline 730 px). Repeated physical presses add a page to the undelivered destination and immediately restart from the live position. Home/End and Ctrl+Home/End animate only if their destination section is already mounted and the clamped distance is at most two viewports; all other edges jump. |
| Key repeat / re-entry | Previously only `repeat=true` duplicates were ignored. Router now accepts one down per physical code until keyup, including duplicate forwarded/original downs with `repeat=false`, and ignores stray repeats after a focus reset. There is no press/release loop in the reviewed code. Tests cover duplicate downs and keyups, and ensure a glide stays stopped for another second. The earlier buggy-recorder loop is not reproduced by unit tests; native verification belongs to PM. |
| FlowRenderer anchoring / slot corrections | `reconcile` keeps slot heights on unmount; real measurements update heights through `FlowSlots.#commit`. The correction preserves the reading anchor across prepend/append/reflow and runs only for changed layout, never to complete an animation. Animation writes relative frame deltas, so a genuine layout correction is retained rather than undone by stale absolute positions. Scroll settle captures a locator/text Range only; it performs no scroll write or line rounding. Real late-loading media may still require a geometry correction; PM must recheck cross-section mounting in WebView2. |
| CSS scroll-behavior | Explicit `auto` on the outer scroller and `auto !important` on every iframe element. No browser smooth-scroll trajectory competes with the rAF integrator. |
| overflow-anchor | Default changed from native-first to manual-only (`none`), avoiding a deferred native correction competing with explicit writes. Native-first remains an explicit A/B option. This supersedes the earlier Decision/Deviation/R5 descriptions above and the native-first detail in PRD §10.4 for this renderer. |
| Scroll snap | Outer scroller has `scroll-snap-type: none`; iframe CSS forces `scroll-snap-type/align: none !important`. No snap-to-line or completion-time position adjustment exists. |
| Iframe focus / keyup | SectionFrame installs one capture listener each for keydown and keyup. Only clones bubble into the parent; real iframe events do not cross the document boundary. Cancelling a clone cancels the original default action. Keyup resolves the held code before editable-field guards, so moving focus into an input still releases it. Parent blur resets only when `document.hasFocus()` is false; visibility/boss hide stop both arrow and page animations. |
| Rounding | `ScrollPosition` accumulates fractional error against live scrollTop and writes the nearest device pixel (devicePixelRatio), retaining read-back error. Removed the old >=1 px remainder discard. Absolute scrollTop is never rounded to a line; finite trajectories finish with their last tiny integrated delta and no final flush, anchor restore or extra snap. Integer/device-pixel output can alternate by one quantum or contain subpixel-tail zero frames; a subsequent tail step is at most 1 CSS px in tested scales. |
| Interruptions / reduced motion | Wheel, pointerdown on the scroller, arrow navigation, style/resize, explicit navigation, real blur/hide, save and destroy cancel page animation. Reduced motion snaps taps/pages/edges; the media query is re-read for navigation and changes cancel existing motion. |

### Verification and handoff

Fake-clock tests exercise continuous and quantized tap curves in both directions at 60/144/240 Hz and device scales 1/1.5/2: non-increasing continuous deltas after the peak (quantized samples within one device pixel), final delta <=1 CSS px, and no zero followed by a jump larger than 1 CSS px. Held deltas at constant speed differ by at most one device pixel. Page tests require exact overlap targets within 200 ms, a tiny last delta, repeated retargets, reverse/cancel and reduced motion. Renderer tests cover nearby mounted edges versus distant/unmounted jumps, real page wiring, retained geometry corrections and no settle-time position write. These are deterministic tests, not new native measurements.

Do **not** run `scripts/measure-scroll.mjs` in the sandbox. Dany_PM should record the after trace with the release executable and an isolated test profile, checking single-tap easing, iframe focus/keyup, 240 Hz holds and chapter-boundary corrections against `docs/measurements/scroll-before.json`.

Validation: **22 tests added** (15 input/physics/router, 7 renderer scroll integration); existing tap and ReaderView tests updated. `npm run check` passed: ESLint, TypeScript, 155 Vitest tests, rustfmt, Clippy and 60 Rust tests. `node scripts/contract-check.mjs .` passed against unchanged contract 0.2.0. `npm run build:test` passed and rebuilt `src-tauri/target/release/e-reader.exe`; all app/test commands used `.test-profile` profiles. Native after-measurements remain for Dany_PM.

### Contract 0.2.1 proposal for Dany_PM

The task's final rule forbids edits to `contract/`, despite the earlier PM authorization. Therefore the contract and its Rust mirror remain at 0.2.0 in this handoff. Apply together:

- Remove `chapter.next` and `chapter.prev` from `contract/types.ts` ACTION_IDS, `settings.schema.json` ActionId enum, `settings.md` default keymap, `rust-types.md` ActionId and `src-tauri/src/contract/mod.rs`. Remove their default bindings wherever present; `settings.defaults.json` currently has only `keybindings: {}`, so has no entries to delete. Runtime keymap and ReaderView already remove them, including stale saved overrides.
- Bump the contract version references/examples and matching Rust constant from 0.2.0 to 0.2.1; update the frozen action count from 36 to 34. Changelog: `0.2.1 | 2026-11-10 | Owner retired next/previous section actions and all ]/[ / Ctrl+Page bindings; settings and database schema versions unchanged.`
- Update the hard-coded 36-action expectation in `scripts/contract-check.mjs` to 34 in the same PM change (outside this chunk's file ownership), then rerun `node scripts/contract-check.mjs .`. The current unchanged contract should remain green.
