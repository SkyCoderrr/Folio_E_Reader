import { describe, it, expect } from 'vitest';
import { planMounts, selectWindow } from './slotWindow';

const base = { count: 20, radius: 1, maxMounted: 5, direction: 0 as const };

describe('selectWindow', () => {
  it('is the visible section ±1 normally', () => {
    expect(selectWindow({ ...base, firstVisible: 7, lastVisible: 7 })).toEqual({ first: 6, last: 8 });
  });
  it('is ±2 while scrolling fast (5 sections)', () => {
    expect(selectWindow({ ...base, radius: 2, firstVisible: 7, lastVisible: 7 })).toEqual({ first: 5, last: 9 });
  });
  it('clips at the book edges', () => {
    expect(selectWindow({ ...base, firstVisible: 0, lastVisible: 0 })).toEqual({ first: 0, last: 1 });
    expect(selectWindow({ ...base, firstVisible: 19, lastVisible: 19 })).toEqual({ first: 18, last: 19 });
  });
  it('caps at maxMounted and keeps sections ahead of the scroll direction', () => {
    const down = selectWindow({ ...base, radius: 2, direction: 1, firstVisible: 7, lastVisible: 8 });
    expect(down).toEqual({ first: 6, last: 10 });
    const up = selectWindow({ ...base, radius: 2, direction: -1, firstVisible: 7, lastVisible: 8 });
    expect(up).toEqual({ first: 5, last: 9 });
    const still = selectWindow({ ...base, radius: 2, direction: 0, firstVisible: 7, lastVisible: 8 });
    expect(still.last - still.first + 1).toBe(5);
  });
  it('strictly caps tiny visible chapters starting at the first visible chapter', () => {
    expect(selectWindow({ ...base, firstVisible: 3, lastVisible: 10 })).toEqual({ first: 3, last: 7 });
  });
  it('handles an empty book', () => {
    expect(selectWindow({ ...base, count: 0, firstVisible: 0, lastVisible: 0 })).toEqual({ first: 0, last: -1 });
  });
});

describe('planMounts', () => {
  const none = new Set<number>();
  it('mounts the missing sections, visible centre first', () => {
    const p = planMounts([], { first: 4, last: 6 }, none, 5);
    expect(p.mount).toEqual([5, 4, 6]);
    expect(p.unmount).toEqual([]);
  });
  it('unmounts sections more than one beyond the window', () => {
    const p = planMounts([1, 2, 5, 6], { first: 5, last: 7 }, none, 5);
    expect(p.mount).toEqual([7]);
    expect(p.unmount).toEqual([1, 2]);
  });
  it('keeps a just-left neighbour (hysteresis) while under the cap', () => {
    const p = planMounts([4, 5, 6, 7], { first: 5, last: 7 }, none, 5);
    expect(p.unmount).toEqual([]);
  });
  it('drops hysteresis neighbours once the cap would be exceeded', () => {
    const p = planMounts([3, 4, 5, 6, 7, 8, 9], { first: 4, last: 8 }, none, 5);
    expect(p.unmount).toEqual([3, 9]);
  });
  it('never unmounts pinned sections (navigation in flight)', () => {
    const p = planMounts([0, 1, 12], { first: 0, last: 2 }, new Set([12]), 5);
    expect(p.unmount).toEqual([]);
    expect(p.mount).toEqual([2]);
  });
});
