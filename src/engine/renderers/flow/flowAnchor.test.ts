// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { locatorAttempts, locatorOf, type LocatorBridge } from './flowAnchor';
import { buildSectionText } from './sectionText';

const doc = new DOMParser().parseFromString('<body><p>0123456789</p></body>', 'text/html');
const slots = { frameAt: () => ({ text: () => buildSectionText(doc) }) } as unknown as Parameters<typeof locatorOf>[0];
const at = (offset: number) => {
  const range = doc.createRange();
  range.setStart(doc.querySelector('p')!.firstChild!, offset);
  return { index: 1, range, viewportY: 0, fraction: 0 };
};
const sizes = [100, 400, 500]; // bytes: a different basis than the chars below
const chars = [10, 10, 80];
const bridge = (known: boolean): LocatorBridge => ({ sectionChars: () => (known ? chars : null) });

it('progress has one basis: the section chars once known, the sizes before', () => {
  expect(locatorOf(slots, at(5), sizes, bridge(true), false).progress).toBeCloseTo(15 / 100);
  expect(locatorOf(slots, at(5), sizes, bridge(false), false).progress).toBeCloseTo((100 + 200) / 1000);
});

it('N1: progress is exactly 1 when the view is at the end of the book', () => {
  const loc = locatorOf(slots, at(5), sizes, bridge(true), true);
  expect(loc.progress).toBe(1);
  expect(loc.charOffset).toBe(5); // the position itself is unchanged
});

it('without a live range the offset is estimated in chars and restored by position', () => {
  const loc = locatorOf(slots, { index: 2, range: null, viewportY: 0, fraction: 0.5 }, sizes, bridge(true), false);
  expect(loc).toMatchObject({ sectionIndex: 2, charOffset: 40, cfi: null, snippet: '' });
  expect(loc.progress).toBeCloseTo((20 + 40) / 100);
  const unknown = locatorOf(slots, { index: 2, range: null, viewportY: 0, fraction: 0.5 }, sizes, bridge(false), false);
  expect(unknown.charOffset).toBe(0);
  // No text evidence at all: the first restore attempt is the book position, not section 2's start.
  const [first] = locatorAttempts(unknown, sizes, bridge(false));
  expect(first!()![0]).toBe(2);
});
