import type { ScrollSettings } from '@contract/types';
import defaults from '../../../contract/settings.defaults.json';
import { browserClock, minStep, ScrollAnimation, type FrameClock } from './scrollAnimation';
export type { FrameClock } from './scrollAnimation';

/** A view scrolled by pixels (FlowRenderer): held keys glide, release decelerates. */
export interface ContinuousTarget {
  readonly kind: 'continuous';
  scrollBy(px: number): void;
  getScrollTop(): number;
  getMaxScroll(): number;
  getLineHeight(): number;
  /** One device pixel in CSS px: the smallest step the view can show (G-PM4). */
  getPixelSize(): number;
}

/**
 * A view that moves by whole pages (PaginatorRenderer, ADR-005). A key press is one hold:
 * holdStart turns one page at once and says whether the view then follows the held key with
 * continuous travel (two-page filmstrip) or not (one page per press); holdMove is that travel and
 * returns false at the book edge; holdEnd (release, stop, edge) settles on a page.
 */
export interface PagedTarget {
  readonly kind: 'paged';
  holdStart(direction: 1 | -1): boolean;
  holdMove(px: number): boolean;
  holdEnd(): void;
}

export type ScrollTarget = ContinuousTarget | PagedTarget;

/** Velocity the key-down ramp starts from: >= 1 px per frame at every refresh rate up to 240 Hz. */
export const START_FLOOR_PX_S = 240;
/**
 * Distance a continuous press moves on the keydown itself, so the first frame painted after the
 * key already shows motion (otherwise the first move waits for the next animation frame, which
 * runs after that frame's other callbacks). The ramp continues from there.
 */
export const PRESS_LEAD_PX = 1;
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
  /** Timestamp of the last frame the held motion ran in (a repeat in the same frame is no new frame). */
  private lastFrame = -Infinity;
  private glide: ScrollAnimation | null;
  constructor(
    private target: ScrollTarget,
    public settings: ScrollSettings = { ...defaults.scroll },
    private clock: FrameClock = browserClock,
    private reducedMotion = false,
  ) {
    this.glide = target.kind === 'continuous' ? new ScrollAnimation(target, clock) : null;
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
    this.lastFrame = -Infinity;
    this.travelled = 0;
    const target = this.target;
    if (target.kind === 'paged') {
      if (!target.holdStart(direction) || this.reducedMotion) return;
    } else if (this.reducedMotion) {
      target.scrollBy(direction * this.settings.tapLines * target.getLineHeight());
      return;
    } else {
      target.scrollBy(direction * PRESS_LEAD_PX);
      this.travelled = PRESS_LEAD_PX;
      if (this.atEdge(direction)) return this.stop();
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
    const target = this.target;
    const at = target.kind === 'continuous' ? target.getScrollTop() : 0;
    this.stop();
    // A page target settled in stop() (holdEnd): it has no release glide.
    if (this.reducedMotion || target.kind === 'paged' || !this.glide) return;
    if (now - this.started < 120) {
      const remaining = Math.max(0, this.settings.tapLines * target.getLineHeight() - travelled);
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
    this.glide?.stop();
    if (this.direction !== 0 && this.target.kind === 'paged') this.target.holdEnd();
    this.direction = 0;
    this.velocity = 0;
  }
  private atEdge(direction: 1 | -1): boolean {
    const t = this.target as ContinuousTarget;
    const at = t.getScrollTop();
    return direction < 0 ? at <= 0 : at >= t.getMaxScroll();
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
    const target = this.target;
    // One clock (G-PM4): a frame stamped before the key press (its frame began before the event
    // was handled) adds no time and never moves `last` backwards; it still shows a step.
    const now = Math.max(time, this.last);
    const integrated = this.integrate(this.last, now);
    const step = target.kind === 'continuous' && time > this.lastFrame ? minStep(target) : 0;
    this.lastFrame = time;
    const delta = Math.abs(integrated) < step ? this.direction * step : integrated;
    this.velocity = this.heldVelocity(now);
    this.last = now;
    this.travelled += Math.abs(delta);
    let moving: boolean;
    if (target.kind === 'paged') moving = target.holdMove(delta);
    else {
      target.scrollBy(delta);
      moving = delta === 0 || !this.atEdge(delta > 0 ? 1 : -1);
    }
    if (moving) this.frame = this.clock.request(this.tick);
    else this.stop();
  };
}
