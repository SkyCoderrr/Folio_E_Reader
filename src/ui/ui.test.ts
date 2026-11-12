import { describe, expect, it } from 'vitest';
import {
  REVEAL_MS,
  REVEAL_ZONE_PX,
  HIDE_FADE_MS,
  chromeWantsVisible,
  fadeMs,
  inRevealZone,
} from './chromeReveal';
import { TOOLTIP_DELAY_MS, tooltipDelay } from './tooltipTiming';
import { captionRectsValid, createLatestSender, measureCaptionRects } from './captionRects';
import { dragAction } from './titleBarActions';

const none = {
  pinned: false,
  pointerInZone: false,
  hovering: false,
  menuOpen: false,
  focusWithin: false,
};

describe('chrome reveal', () => {
  it('reveals in the top 56 px within 100 ms', () => {
    expect(REVEAL_ZONE_PX).toBe(56);
    expect(REVEAL_MS).toBeLessThanOrEqual(100);
    expect(inRevealZone(0)).toBe(true);
    expect(inRevealZone(56)).toBe(true);
    expect(inRevealZone(57)).toBe(false);
    expect(inRevealZone(Number.NaN)).toBe(false);
  });
  it('stays while hovered, menu open, focused or pinned', () => {
    expect(chromeWantsVisible(none)).toBe(false);
    for (const k of ['pinned', 'pointerInZone', 'hovering', 'menuOpen', 'focusWithin'] as const)
      expect(chromeWantsVisible({ ...none, [k]: true })).toBe(true);
  });
  it('fades in faster than out', () => {
    expect(fadeMs(true)).toBe(100);
    expect(fadeMs(false)).toBe(HIDE_FADE_MS);
  });
});

describe('tooltip timing', () => {
  it('500 ms delay, instant when adjacent', () => {
    expect(tooltipDelay(1000, null)).toBe(TOOLTIP_DELAY_MS);
    expect(tooltipDelay(1100, 1000)).toBe(0);
    expect(tooltipDelay(2000, 1000)).toBe(TOOLTIP_DELAY_MS);
  });
});

describe('title bar drag', () => {
  it('drags on single primary press, maximizes on double, ignores other buttons', () => {
    expect(dragAction({ button: 0, detail: 1 })).toBe('drag');
    expect(dragAction({ button: 0, detail: 2 })).toBe('toggle-maximize');
    expect(dragAction({ button: 2, detail: 1 })).toBeNull();
  });
});

const box = (x: number) => ({ getBoundingClientRect: () => ({ x, y: 0, width: 46, height: 40 }) });

describe('caption rects', () => {
  it('measures three adjacent 46x40 buttons', () => {
    const r = measureCaptionRects(
      { minimize: box(1142), maximize: box(1188), close: box(1234) },
      1280,
      720,
    );
    expect(r?.close).toEqual({ x: 1234, y: 0, width: 46, height: 40 });
  });
  it('returns null for missing, overlapping or off-viewport geometry', () => {
    expect(
      measureCaptionRects({ minimize: null, maximize: box(1), close: box(2) }, 1280, 720),
    ).toBeNull();
    expect(
      measureCaptionRects({ minimize: box(100), maximize: box(120), close: box(300) }, 1280, 720),
    ).toBeNull();
    expect(
      measureCaptionRects(
        { minimize: box(1142), maximize: box(1188), close: box(1250) },
        1280,
        720,
      ),
    ).toBeNull();
    const zero = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) };
    expect(
      measureCaptionRects({ minimize: zero, maximize: box(60), close: box(120) }, 1280, 720),
    ).toBeNull();
  });
  it('validity rejects non-finite values', () => {
    const r = { x: 0, y: 0, width: 46, height: 40 };
    expect(
      captionRectsValid(
        { minimize: { ...r, x: Number.NaN }, maximize: { ...r, x: 50 }, close: { ...r, x: 100 } },
        500,
        100,
      ),
    ).toBe(false);
  });
});

describe('latest sender', () => {
  it('keeps one in flight and coalesces to the latest pending value', async () => {
    const sent: number[] = [];
    const gates: Array<() => void> = [];
    const s = createLatestSender<number>(
      (v) =>
        new Promise<void>((res) => {
          sent.push(v);
          gates.push(res);
        }),
    );
    s.push(1);
    s.push(2);
    s.push(3);
    expect(sent).toEqual([1]);
    gates[0]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([1, 3]);
    gates[1]!();
  });
  it('survives a failing send', async () => {
    const sent: number[] = [];
    const s = createLatestSender<number>(async (v) => {
      sent.push(v);
      if (v === 1) throw new Error('boom');
    });
    s.push(1);
    await new Promise((r) => setTimeout(r, 0));
    s.push(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([1, 2]);
  });
});
