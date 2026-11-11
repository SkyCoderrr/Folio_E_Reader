export interface FrameClock {
  now(): number;
  request(cb: (time: number) => void): number;
  cancel(id: number): void;
}
export const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

export interface PositionTarget {
  scrollBy(px: number): void;
  getScrollTop(): number;
  getMaxScroll(): number;
}

/** Finite ease-out trajectory. Deliver differences, so layout anchoring is never undone. */
export class ScrollAnimation {
  private frame = 0;
  private started = 0;
  private distance = 0;
  private delivered = 0;
  private tangent = 0;
  private duration = 200;

  constructor(
    private target: PositionTarget,
    private clock: FrameClock = browserClock,
    /** Called when a trajectory completes (not on stop() or when superseded by to()). */
    private onDone?: () => void,
  ) {}

  get active(): boolean {
    return this.frame !== 0;
  }

  /** Current speed along the trajectory, px/s (0 when idle). Lets a retarget keep momentum. */
  get velocity(): number {
    if (!this.frame) return 0;
    const t = Math.min(1, Math.max(0, (this.clock.now() - this.started) / this.duration));
    const a = this.tangent;
    const b = 12 * this.distance - 4 * a;
    return ((1 - t) ** 2 * (a + b * t) * 1000) / this.duration;
  }

  /** Includes undelivered distance, for repeated page presses. */
  get destination(): number {
    return this.target.getScrollTop() + this.distance - this.delivered;
  }

  to(
    position: number,
    reducedMotion = false,
    duration = 200,
    initialVelocity?: number,
    pending = 0,
  ): void {
    this.stop();
    const at = this.target.getScrollTop();
    this.distance = Math.max(0, Math.min(this.target.getMaxScroll(), position)) - at - pending;
    this.delivered = -pending;
    if (reducedMotion || duration <= 0) {
      this.target.scrollBy(this.distance - this.delivered);
      this.distance = this.delivered = 0;
      return;
    }
    if (this.distance === 0) return;
    // Preserve the release velocity by shortening the curve instead of clipping
    // its tangent. a <= 3*distance keeps velocity directed toward the target.
    const speed = Math.sign(this.distance) * (initialVelocity ?? 0);
    if (speed > 0) duration = Math.min(duration, (3000 * Math.abs(this.distance)) / speed);
    this.duration = duration;
    // Velocity = (1-t)^2 * (a + b*t), b = 12*distance - 4*a.
    // Both velocity and acceleration reach zero; speed has at most one peak.
    // Omitted velocity gives ease-out-cubic; taps retain their current ramp velocity.
    this.tangent =
      initialVelocity === undefined
        ? 3 * this.distance
        : Math.sign(this.distance) * Math.max(0, (speed * duration) / 1000);
    this.started = this.clock.now();
    this.frame = this.clock.request(this.tick);
  }

  stop(): void {
    this.clock.cancel(this.frame);
    this.frame = 0;
    this.distance = this.delivered = 0;
  }

  private tick = (time: number): void => {
    const elapsed = time - this.started;
    const t = elapsed >= this.duration - 1e-7 ? 1 : Math.max(0, elapsed / this.duration);
    const a = this.tangent;
    const b = 12 * this.distance - 4 * a;
    const position =
      t === 1
        ? this.distance
        : a * (t - t * t + t ** 3 / 3) + b * ((t * t) / 2 - (2 * t ** 3) / 3 + t ** 4 / 4);
    const delta = position - this.delivered;
    this.delivered = position;
    this.target.scrollBy(delta);
    const at = this.target.getScrollTop();
    if (t === 1 || (delta < 0 && at <= 0) || (delta > 0 && at >= this.target.getMaxScroll())) {
      this.stop();
      this.onDone?.();
    } else {
      this.frame = this.clock.request(this.tick);
    }
  };
}
