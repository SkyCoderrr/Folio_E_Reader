import type { AutoscrollSettings } from '@contract/types';
import { browserClock, type FrameClock } from './scrollAnimation';
import type { ScrollTarget } from './smoothScroller';

export type AutoScrollState = 'off' | 'running' | 'paused';
export interface AutoScrollTarget extends ScrollTarget {
  page(dir: 1 | -1): void;
  getViewportHeight(): number;
  isAtEnd(): boolean;
  /** True for page-turning renderers (paginator, two-page filmstrip): auto-scroll turns one page every viewport-height of travel instead of scrolling pixels (ADR-005). */
  readonly turnsPages?: boolean;
}
export function autoScrollSpeed(speed: number, step: number, direction: 1 | -1): number {
  return Math.min(
    400,
    Math.max(5, speed * (1 + (direction * Math.min(50, Math.max(1, step))) / 100)),
  );
}

/** Uses the same frame clock and fractional pixel writer as held scrolling. */
export class AutoScroller {
  state: AutoScrollState = 'off';
  private frame = 0;
  private last = 0;
  private pending = 0;
  constructor(
    private target: AutoScrollTarget,
    public settings: AutoscrollSettings,
    private paged = false,
    private reducedMotion = false,
    private changed: (state: AutoScrollState) => void = () => {},
    private clock: FrameClock = browserClock,
  ) {}
  toggle() {
    if (this.state === 'off') this.resume();
    else this.stop();
  }
  togglePause() {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }
  pause() {
    if (this.state === 'running') this.setState('paused');
  }
  stop() {
    this.setState('off');
  }
  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
    this.pending = 0;
  }
  adjust(direction: 1 | -1) {
    this.settings = {
      ...this.settings,
      speed: autoScrollSpeed(this.settings.speed, this.settings.step, direction),
    };
    this.changed(this.state);
    return this.settings.speed;
  }
  private resume() {
    this.last = this.clock.now();
    this.pending = 0;
    this.setState('running');
    this.frame = this.clock.request(this.tick);
  }
  private setState(state: AutoScrollState) {
    this.clock.cancel(this.frame);
    this.frame = 0;
    this.state = state;
    this.changed(state);
  }
  private tick = (time: number) => {
    this.frame = 0;
    if (this.target.isAtEnd()) {
      this.pause();
      return;
    }
    this.pending +=
      (Math.max(0, time - this.last) * Math.min(400, Math.max(5, this.settings.speed))) / 1000;
    this.last = time;
    if (this.paged || this.target.turnsPages === true) {
      const distance = Math.max(1, this.target.getViewportHeight());
      if (this.pending >= distance) {
        this.pending %= distance;
        this.target.page(1);
      }
    } else if (this.reducedMotion) {
      const line = Math.max(1, this.target.getLineHeight());
      if (this.pending >= line) {
        const distance = Math.floor(this.pending / line) * line;
        this.pending -= distance;
        this.target.scrollBy(distance);
      }
    } else {
      this.target.scrollBy(this.pending);
      this.pending = 0;
    }
    if (this.target.isAtEnd()) this.pause();
    else if (this.state === 'running') this.frame = this.clock.request(this.tick);
  };
}
