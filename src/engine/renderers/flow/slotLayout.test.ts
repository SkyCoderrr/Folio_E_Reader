import { describe, it, expect } from 'vitest';
import { SlotLayout } from './slotLayout';

const geo = { padTop: 40, padBottom: 40, separatorPx: 60 };

describe('SlotLayout', () => {
  it('stacks padTop, separators (not before slot 0) and content heights', () => {
    const l = new SlotLayout(3, geo);
    l.setContentHeight(0, 1000, true);
    l.setContentHeight(1, 500, true);
    l.setContentHeight(2, 2000, false);
    expect(l.slotTop(0)).toBe(40);
    expect(l.contentTop(0)).toBe(40);
    expect(l.slotTop(1)).toBe(1040);
    expect(l.contentTop(1)).toBe(1100);
    expect(l.slotTop(2)).toBe(1600);
    expect(l.contentTop(2)).toBe(1660);
    expect(l.totalHeight).toBe(40 + 1000 + 560 + 2060 + 40);
  });

  it('indexAt maps padding to the first/last slot and boundaries to the lower slot', () => {
    const l = new SlotLayout(3, geo, 100);
    expect(l.indexAt(-5)).toBe(0);
    expect(l.indexAt(0)).toBe(0);
    expect(l.indexAt(139)).toBe(0);
    expect(l.indexAt(140)).toBe(1); // slot 1 starts at 40 + 100
    expect(l.indexAt(299)).toBe(1);
    expect(l.indexAt(300)).toBe(2);
    expect(l.indexAt(1e9)).toBe(2);
    expect(new SlotLayout(0, geo).indexAt(0)).toBe(-1);
  });

  it('recomputes offsets lazily only from the changed slot onwards', () => {
    const l = new SlotLayout(4, geo, 100);
    const before = [0, 1, 2, 3].map((i) => l.slotTop(i));
    expect(l.setContentHeight(2, 350, true)).toBe(true);
    expect(l.setContentHeight(2, 350, true)).toBe(false);
    expect(l.slotTop(0)).toBe(before[0]);
    expect(l.slotTop(2)).toBe(before[2]);
    expect(l.slotTop(3)).toBe(before[3]! + 250);
    expect(l.isMeasured(2)).toBe(true);
    expect(l.isMeasured(1)).toBe(false);
  });

  it('skips zero-height slots in indexAt (the visible slot wins)', () => {
    const l = new SlotLayout(3, { padTop: 0, padBottom: 0, separatorPx: 0 });
    l.setContentHeight(0, 100, true);
    l.setContentHeight(1, 0, true);
    l.setContentHeight(2, 100, true);
    expect(l.indexAt(100)).toBe(2);
  });

  it('setGeometry shifts every slot', () => {
    const l = new SlotLayout(2, geo, 100);
    l.setGeometry({ padTop: 10, padBottom: 0, separatorPx: 20 });
    expect(l.slotTop(1)).toBe(110);
    expect(l.contentTop(1)).toBe(130);
    expect(l.totalHeight).toBe(10 + 100 + 120);
  });
});
