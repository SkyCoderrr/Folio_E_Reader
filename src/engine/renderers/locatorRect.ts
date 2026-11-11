import type { Locator } from '@contract/types';
import type { LocatorBridge } from './flow/flowAnchor';
import type { SectionFrame } from './flow/sectionFrame';
import { rangeAtOffset } from './flow/sectionText';

/** Browser viewport coordinates, including the iframe's scroll/transform placement. */
export interface LocatorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  marginLeft: number;
}

/** Read mounted frames only: never navigate, mount, or fall back to another section. */
export function locatorViewportRect(
  locator: Locator,
  frameAt: (index: number) => SectionFrame | null,
  viewport: HTMLElement | null,
  bridge?: LocatorBridge,
  columnPitch = 0,
): LocatorRect | null {
  if (!viewport) return null;
  const global =
    locator.globalCharOffset !== null
      ? bridge?.fromGlobalCharOffset?.(locator.globalCharOffset)
      : null;
  const cfi = !global && locator.cfi ? bridge?.parseCfi?.(locator.cfi) : null;
  const index = global?.sectionIndex ?? cfi?.sectionIndex ?? locator.sectionIndex;
  const frame = frameAt(index);
  if (!frame?.ready || !frame.doc || frame.iframe.style.visibility === 'hidden') return null;
  const text = frame.text();
  if (!text?.total) return null;
  const offset = global?.charOffset ?? locator.charOffset;
  const range = cfi?.toRange(frame.doc) ?? rangeAtOffset(frame.doc, text, offset);
  // A non-collapsed character produces a reliable line rectangle in Chromium.
  if (
    range.collapsed &&
    range.startContainer.nodeType === 3 &&
    range.startOffset < (range.startContainer.textContent?.length ?? 0)
  )
    range.setEnd(range.startContainer, range.startOffset + 1);
  const origin = frame.iframe.getBoundingClientRect();
  const clip = viewport.getBoundingClientRect();
  for (const rect of Array.from(range.getClientRects())) {
    const box = {
      left: origin.left + rect.left,
      top: origin.top + rect.top,
      right: origin.left + rect.right,
      bottom: origin.top + rect.bottom,
    };
    if (
      rect.height > 0 &&
      box.bottom > clip.top &&
      box.top < clip.bottom &&
      box.right > clip.left &&
      box.left < clip.right
    )
      return {
        ...box,
        marginLeft:
          origin.left +
          (columnPitch > 0 ? Math.floor((rect.left + 1) / columnPitch) * columnPitch : 0),
      };
  }
  return null;
}
