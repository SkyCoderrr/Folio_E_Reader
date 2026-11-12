// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Locator } from '@contract/types';
import { locatorViewportRect } from './locatorRect';
import { SectionFrame } from './flow/sectionFrame';
import { FlowRenderer } from './FlowRenderer';
import { PaginatorRenderer } from './PaginatorRenderer';

const locator: Locator = {
  sectionIndex: 0,
  charOffset: 4,
  cfi: null,
  globalCharOffset: null,
  snippet: '',
  progress: 0.1,
};
function rig() {
  const viewport = document.createElement('div');
  viewport.getBoundingClientRect = () => new DOMRect(100, 50, 1000, 800);
  const frame = new SectionFrame(0, {
    onContentResize() {},
    onKey() {},
    onWheel() {},
    onLink() {},
  });
  frame.doc = document.implementation.createHTMLDocument();
  frame.doc.body.textContent = 'a bookmarked line';
  frame.show();
  let x = 160,
    y = 100,
    lineX = 20,
    lineY = 30;
  frame.iframe.getBoundingClientRect = () => new DOMRect(x, y, 900, 2000);
  vi.spyOn(frame.doc, 'createRange').mockImplementation(() => {
    const range = new Range();
    range.getClientRects = () => [new DOMRect(lineX, lineY, 8, 24)] as unknown as DOMRectList;
    return range;
  });
  const frameAt = vi.fn((i: number) => (i === 0 ? frame : null));
  return {
    frame,
    frameAt,
    viewport,
    move: (left: number, top: number) => {
      x = left;
      y = top;
    },
    line: (left: number, top: number) => {
      lineX = left;
      lineY = top;
    },
    rect: (l = locator) => locatorViewportRect(l, frameAt, viewport),
  };
}
afterEach(() => vi.restoreAllMocks());
it('Flow: adds the iframe viewport offset and tracks vertical scrolling', () => {
  const r = rig();
  expect(r.rect()).toEqual({ left: 180, right: 188, top: 130, bottom: 154, marginLeft: 160 });
  r.move(160, -20); // fully clipped
  expect(r.rect()).toBeNull();
  r.move(160, 10);
  expect(r.rect()?.top).toBe(40); // partial line remains visible
});
it('PageGrid: respects the second column and clips rows outside the viewport', () => {
  const r = rig();
  r.line(580, 230);
  expect(r.rect()?.left).toBe(740);
  r.line(580, 900);
  expect(r.rect()).toBeNull();
});
it('Paginator: includes translated iframe position and rejects other spreads', () => {
  const r = rig();
  r.line(1820, 30);
  r.move(-1640, 100);
  expect(r.rect()?.left).toBe(180);
  r.line(20, 30);
  expect(r.rect()).toBeNull();
});
it('reads only the resolved mounted section; supports TXT global positions and EPUB CFI', () => {
  const r = rig();
  expect(r.rect({ ...locator, sectionIndex: 2 })).toBeNull();
  const text = r.frame.doc!.body.firstChild!;
  const cfiRange = r.frame.doc!.createRange();
  cfiRange.setStart(text, 2);
  cfiRange.collapse(true);
  expect(
    locatorViewportRect({ ...locator, sectionIndex: 9, cfi: 'cfi' }, r.frameAt, r.viewport, {
      parseCfi: () => ({ sectionIndex: 0, toRange: () => cfiRange }),
    })?.top,
  ).toBe(130);
  expect(
    locatorViewportRect(
      { ...locator, sectionIndex: 9, globalCharOffset: 50 },
      r.frameAt,
      r.viewport,
      { fromGlobalCharOffset: () => ({ sectionIndex: 0, charOffset: 4 }) },
    )?.top,
  ).toBe(130);
  expect(r.frameAt.mock.calls.map(([index]) => index)).toEqual([2, 0, 0]);
});
it('rejects hidden frames, empty text and unmounted renderers without side effects', () => {
  const r = rig();
  r.frame.iframe.style.visibility = 'hidden';
  expect(r.rect()).toBeNull();
  for (const renderer of [new FlowRenderer(), new PaginatorRenderer()])
    expect(renderer.getLocatorRect(locator)).toBeNull();
});

it('uses the column margin rather than the bookmarked character indent', () => {
  const r = rig();
  r.line(680, 30);
  expect(locatorViewportRect(locator, r.frameAt, r.viewport, undefined, 600)?.marginLeft).toBe(760);
  r.move(-1040, 100);
  r.line(1280, 30);
  expect(locatorViewportRect(locator, r.frameAt, r.viewport, undefined, 600)?.marginLeft).toBe(160);
});
