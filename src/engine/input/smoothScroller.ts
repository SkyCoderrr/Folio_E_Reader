import type { ScrollSettings } from '@contract/types';
import defaults from '../../../contract/settings.defaults.json';
import { browserClock, ScrollAnimation, type FrameClock } from './scrollAnimation';
export type { FrameClock } from './scrollAnimation';

export interface ScrollTarget {
  scrollBy(px: number): void;
  getScrollTop(): number;
  getMaxScroll(): number;
  getLineHeight(): number;
  /**
   * Optional press boundaries for targets that move by whole pages (PaginatorRenderer, ADR-005):
   * holdStart on every key press (before its first scrollBy), holdEnd once the held motion stops
   * (release, stop, edge). The release glide's scrollBy deltas arrive after holdEnd.
   */
  holdStart?(direction: 1 | -1): void;
  holdEnd?(): void;
}
/** Velocity the key-down ramp starts from: >= 1 px in the first frame at 60 Hz and 120 Hz. */
export const START_FLOOR_PX_S = 120;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Frame-time integration; OS key repeat never contributes distance. */
export class SmoothScroller {
  private frame = 0;
  private direction: 1 | -1 | 0 = 0;
  private started = 0;
  private last = 0;
  private velocity = 0;
  private travelled = 0;
  private initialVelocity = 0;
  private glide: ScrollAnimation;
  constructor(
    private target: ScrollTarget,
    public settings: ScrollSettings = { ...defaults.scroll },
    private clock: FrameClock = browserClock,
    private reducedMotion = false,
  ) {
    this.glide = new ScrollAnimation(target, clock);
  }
  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
    if (value) this.stop();
  }
  press(direction: 1 | -1) {
    if (direction === this.direction) return;
    const previousVelocity = this.velocity;
    this.stop();
    // PRD 11: the ease-in must not start at ~0 velocity, or the integer scroll position hides the
    // first frames. The ramp starts from a small floor velocity in the pressed direction.
    this.initialVelocity =
      previousVelocity * direction >= START_FLOOR_PX_S ? previousVelocity : direction * START_FLOOR_PX_S;
    this.direction = direction;
    this.started = this.last = this.clock.now();
    this.travelled = 0;
    this.target.holdStart?.(direction);
    if (this.reducedMotion) {
      this.target.scrollBy(direction * this.settings.tapLines * this.target.getLineHeight());
      return;
    }
    this.frame = this.clock.request(this.tick);
  }
  release(direction: 1 | -1) {
    if (this.direction !== direction) return;
    const now = this.clock.now();
    // Integrate the interval since the last paint before changing trajectories.
    // It is delivered by the next glide frame, never as a keyup-time write.
    const velocity = this.heldVelocity(now);
    const pending = this.integrate(this.last, now);
    const travelled = this.travelled + Math.abs(pending);
    const at = this.target.getScrollTop();
    this.stop();
    if (this.reducedMotion) return;
    // Page-turning targets own the whole press (holdStart turned the page, holdEnd settled it): a
    // release glide would deliver scrollBy after holdEnd and turn a second page.
    if (this.target.holdStart) return;
    if (now - this.started < 120) {
      const remaining = Math.max(
        0,
        this.settings.tapLines * this.target.getLineHeight() - travelled,
      );
      // Deliver the pending held interval once, outside the release curve.
      this.glide.to(at + pending + direction * remaining, false, 200, velocity, pending);
      return;
    }
    if (this.settings.stopDecelMs > 0) {
      // Integral of v0 * (1-t)^2: v0 * duration / 3. Exact finite ease-out.
      this.glide.to(
        at + pending + (velocity * this.settings.stopDecelMs) / 3000,
        false,
        this.settings.stopDecelMs,
      );
    }
  }
  stop() {
    this.clock.cancel(this.frame);
    this.frame = 0;
    this.glide.stop();
    if (this.direction !== 0) this.target.holdEnd?.();
    this.direction = 0;
    this.velocity = 0;
  }
  private heldVelocity(time: number) {
    const elapsed = Math.max(0, time - this.started);
    const ramp =
      this.reducedMotion || !this.settings.startRampMs
        ? 1
        : clamp01(elapsed / this.settings.startRampMs);
    const accel = this.settings.acceleration
      ? 1 + (this.settings.accelMax - 1) * clamp01(elapsed / this.settings.accelRampMs)
      : 1;
    return (
      this.initialVelocity * (1 - ramp) + this.direction * this.settings.arrowSpeed * ramp * accel
    );
  }
  private integrate(from: number, time: number): number {
    // Integrate at <= 2ms intervals so refresh rate changes do not change distance.
    let delta = 0;
    for (let t = from; t < time;) {
      const end = Math.min(time, t + 2);
      const mid = (t + end) / 2;
      const v = this.heldVelocity(mid);
      delta += (v * (end - t)) / 1000;
      t = end;
    }
    return delta;
  }
  private tick = (time: number) => {
    const delta = this.integrate(this.last, time);
    this.velocity = this.heldVelocity(time);
    this.last = time;
    this.travelled += Math.abs(delta);
    this.target.scrollBy(delta);
    const at = this.target.getScrollTop();
    if ((delta < 0 && at <= 0) || (delta > 0 && at >= this.target.getMaxScroll())) this.stop();
    else this.frame = this.clock.request(this.tick);
  };
}
