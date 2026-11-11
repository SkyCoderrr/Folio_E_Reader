import { describe, expect, it } from 'vitest';
import { locateColumn, stripBlock, stripBounds, visibleSections } from './stripMath';

// Sections 0..4 with 3, 1, 4, 2, 5 columns; 1..3 ready.
const cols = [3, 1, 4, 2, 5];
const ready = (set: number[]) => (i: number) => set.includes(i);
const columns = (i: number) => cols[i]!;

describe('stripBlock: ready sections end to end, relative to the base', () => {
  it('walks both ways from the base and stops at the first section not ready', () => {
    const b = stripBlock(2, ready([1, 2, 3]), columns, 5);
    expect(b.first).toBe(1);
    expect(b.last).toBe(3);
    expect([...b.starts.entries()].sort((x, y) => x[0] - y[0])).toEqual([
      [1, -1],
      [2, 0],
      [3, 4],
    ]);
    expect(b.end).toBe(6);
  });
});

describe('stripBounds', () => {
  it('in the middle of the book the left page may reach every loaded page', () => {
    const b = stripBlock(2, ready([1, 2, 3]), columns, 5);
    expect(stripBounds(b, 5, 2)).toEqual({ min: -1, max: 5, atBookStart: false, atBookEnd: false });
  });

  it('at the book end the last page rests in the right slot (two pages) or alone (one page)', () => {
    const b = stripBlock(4, ready([3, 4]), columns, 5);
    expect(stripBounds(b, 5, 2)).toMatchObject({ min: -2, max: 3, atBookEnd: true, atBookStart: false });
    expect(stripBounds(b, 5, 1)).toMatchObject({ max: 4 });
  });

  it('a one-page book never moves', () => {
    const b = stripBlock(0, ready([0]), () => 1, 1);
    expect(stripBounds(b, 1, 2)).toEqual({ min: 0, max: 0, atBookStart: true, atBookEnd: true });
  });
});

describe('locateColumn / visibleSections: a chapter end and the next chapter side by side', () => {
  const b = stripBlock(2, ready([1, 2, 3]), columns, 5);
  it('maps base-relative columns to (section, column)', () => {
    expect(locateColumn(b, -1)).toEqual({ index: 1, column: 0 });
    expect(locateColumn(b, 0)).toEqual({ index: 2, column: 0 });
    expect(locateColumn(b, 3)).toEqual({ index: 2, column: 3 });
    expect(locateColumn(b, 4)).toEqual({ index: 3, column: 0 });
    expect(locateColumn(b, 99)).toEqual({ index: 3, column: 1 }); // clamped into the block
  });
  it('two pages at a chapter boundary show the last page of one and the first of the next', () => {
    expect(visibleSections(b, 3, 2)).toEqual([2, 3]);
    expect(visibleSections(b, 2, 2)).toEqual([2]);
    expect(visibleSections(b, 3, 1)).toEqual([2]);
  });
});
