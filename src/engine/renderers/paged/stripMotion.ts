/**
 * Strip motion (ADR-005): the view's visual position `x` eases toward a target with the same finite
 * ease-out as the arrow-key glide and PgDn in scroll flow (input/scrollAnimation.ts). Transform
 * writes only (the caller's `apply`), on animation frames.
 *
 *  - to(): retarget from the current position, keeping the current speed when it is faster than a
 *    fresh ease-out (held keys and wheel retarget every frame and so move continuously).
 *  - Lag cap: at most `maxLead` px may remain when a new target is set; the rest is jumped at once,
 *    so a new turn finishes the current one instantly and rapid turns never queue up.
 *  - Reduced motion: every change is instant.
 *  - `settled` runs whenever the view comes to rest on its target.
 */
import { browserClock, ScrollAnimation, type FrameClock } from '../../input/scrollAnimation';
import { STEP_MS } from './pagedMath';

/** ScrollAnimation clamps to [0, max]; positions are offset into a range it never reaches. */
const FAR = 1e7;

export class StripMotion {
  #x = 0;
  #target = 0;
  #anim: ScrollAnimation;
  #apply: (x: number) => void;
  #settled: () => void;

  constructor(apply: (x: number) => void, settled: () => void, clock: FrameClock = browserClock) {
    this.#apply = apply;
    this.#settled = settled;
    this.#anim = new ScrollAnimation(
      {
        scrollBy: (d) => {
          this.#x += d;
          this.#apply(this.#x);
        },
        getScrollTop: () => this.#x + FAR,
        getMaxScroll: () => 2 * FAR,
        getPixelSize: () => 0, // a transform renders sub-pixel: no step is too small to show
      },
      clock,
      () => this.#rest(),
    );
  }

  get x(): number {
    return this.#x;
  }
  get target(): number {
    return this.#target;
  }
  get active(): boolean {
    return this.#anim.active;
  }

  /** Rebase both positions (the base section changed); motion continues unchanged. */
  shift(dx: number): void {
    this.#x += dx;
    this.#target += dx;
  }

  /** Instant placement (navigation, relayout). Does not call `settled`. */
  jump(x: number): void {
    this.#anim.stop();
    this.#x = this.#target = x;
    this.#apply(x);
  }

  to(target: number, reducedMotion: boolean, maxLead: number, durationMs = STEP_MS): void {
    this.#target = target;
    if (reducedMotion) {
      this.#anim.stop();
      this.#rest();
      return;
    }
    const velocity = this.#anim.velocity;
    let d = target - this.#x;
    if (Math.abs(d) > maxLead) {
      this.#x = target - Math.sign(d) * maxLead;
      d = target - this.#x;
      this.#apply(this.#x);
    }
    if (Math.abs(d) < 0.01) {
      this.#anim.stop();
      this.#rest();
      return;
    }
    // Keep momentum only when it is faster than a fresh ease-out (which starts at 3·d/duration).
    const fresh = (3 * Math.abs(d) * 1000) / durationMs;
    const keep = Math.sign(velocity) === Math.sign(d) && Math.abs(velocity) > fresh;
    this.#anim.to(target + FAR, false, durationMs, keep ? velocity : undefined);
  }

  /** Finish now: jump to the target and settle. */
  finish(): void {
    if (!this.#anim.active) return;
    this.#anim.stop();
    this.#rest();
  }

  stop(): void {
    this.#anim.stop();
  }

  #rest(): void {
    this.#x = this.#target;
    this.#apply(this.#x);
    this.#settled();
  }
}
